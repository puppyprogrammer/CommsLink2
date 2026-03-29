// ┌──────────────────────────────────────────┐
// │ Vegetation & World Time System           │
// └──────────────────────────────────────────┘

import prisma from '../../../../../core/adapters/prisma';
import { broadcastAll, players } from './combat';
import { WebSocket } from 'ws';

// ── Spread Cooldown System ──
// Each plant tracks failed spread attempts. Cooldown doubles on each failure.
// 5min → 10min → 20min → 40min → 1hr max. Resets when a neighbor is destroyed.
const spreadCooldowns = new Map<number, { nextSpread: number; failures: number }>();

const canSpread = (id: number): boolean => {
  const cd = spreadCooldowns.get(id);
  if (!cd) return true;
  return Date.now() >= cd.nextSpread;
};

const recordSpreadFailure = (id: number): void => {
  const cd = spreadCooldowns.get(id) || { nextSpread: 0, failures: 0 };
  cd.failures++;
  // 5min base, doubles each failure, max 1hr
  const waitMs = Math.min(3600000, 300000 * Math.pow(2, cd.failures - 1));
  cd.nextSpread = Date.now() + waitMs;
  spreadCooldowns.set(id, cd);
};

const recordSpreadSuccess = (id: number): void => {
  spreadCooldowns.delete(id); // Reset — can try again next tick
};

/** Wake up plants near a destroyed/trampled position. Called from trampling and critter eating. */
const wakeNearbyPlants = (x: number, z: number, radius: number): void => {
  // We don't know which plant IDs are nearby without a query, so just clear all cooldowns
  // for plants whose stored position might be in range. Since we don't store positions in the
  // cooldown map, we use a simpler approach: clear ALL cooldowns periodically or on trample.
  // For targeted clearing, we'd need to store x/z — but that doubles memory.
  // Compromise: clear cooldowns for any plant that has been waiting > 5min and is "near" the event.
  // Actually simplest: just track by position hash and clear matching hashes.
  // SIMPLEST: clear all cooldowns in the area by iterating (fast for sparse maps).
};

/** Reset cooldowns for all plants near a position (called when vegetation is destroyed). */
const resetCooldownsNear = async (x: number, z: number, radius: number): Promise<void> => {
  // Find plant IDs near the destruction and reset their cooldowns
  const nearby = await prisma.world_vegetation.findMany({
    where: {
      x: { gte: x - radius, lte: x + radius },
      z: { gte: z - radius, lte: z + radius },
      growth_stage: 4,
      health: { gt: 0 },
    },
    select: { id: true },
  });
  for (const p of nearby) {
    spreadCooldowns.delete(p.id);
  }
};

// ── World Time ──
// 1 real minute = 1 game hour → 24 real minutes = 1 game day
// 30 game days = 1 lunar cycle → 12 real hours = 1 full moon cycle

const msPerGameHour = 60 * 1000;
const msPerGameDay = msPerGameHour * 24; // 24 real minutes

const getGameHour = (): number => {
  return (Date.now() / msPerGameHour) % 24;
};

const getGameDay = (): number => {
  return Math.floor(Date.now() / msPerGameDay) % 30; // 0-29, 30-day lunar cycle
};

/** Broadcast nearby — send to all connected players within radius. */
const broadcastNearby = (x: number, z: number, radius: number, msg: object): void => {
  const json = JSON.stringify(msg);
  let sent = 0;
  let checked = 0;
  for (const [id, p] of players) {
    if (!p.ws?.readyState || p.ws.readyState !== WebSocket.OPEN) continue;
    checked++;
    const dx = p.pos[0] - x;
    const dz = p.pos[2] - z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= radius) {
      p.ws.send(json);
      sent++;
    }
  }
  // Log vegetation broadcasts periodically — include player positions for debugging
  if ((msg as { type?: string }).type?.startsWith('vegetation_') && Math.random() < 0.02) {
    const playerPositions = Array.from(players.values())
      .filter(p => p.ws?.readyState === WebSocket.OPEN)
      .map(p => `${p.username}@(${p.pos[0].toFixed(0)},${p.pos[2].toFixed(0)})`).join(', ');
    console.log(`[Vegetation] Broadcast ${(msg as { type: string }).type} at (${x.toFixed(0)},${z.toFixed(0)}) — ${sent}/${checked} in range | players: ${playerPositions}`);
  }
};

// ── Growth Tick (every 30s) ──

const vegetationTick = async (): Promise<void> => {
  // Only grow during daytime (6am-6pm game time)
  const gameHour = getGameHour();
  if (gameHour < 6 || gameHour >= 18) return;

  const now = new Date();

  // Grow ALL vegetation that hasn't grown in last 60s and isn't fully grown
  const grownVeg = await prisma.world_vegetation.findMany({
    where: {
      growth_stage: { lt: 4 },
      health: { gt: 0 },
      last_growth: { lt: new Date(now.getTime() - 60000) },
    },
  });

  for (const veg of grownVeg) {
    await prisma.world_vegetation.update({
      where: { id: veg.id },
      data: { growth_stage: veg.growth_stage + 1, last_growth: now },
    });

    await prisma.vegetation_log.create({ data: {
      veg_id: veg.id, veg_type: veg.type, event: 'grew', x: veg.x, z: veg.z,
      detail: `growth_stage: ${veg.growth_stage}→${veg.growth_stage + 1}`,
    } }).catch(() => {});

    broadcastNearby(veg.x, veg.z, 200, {
      type: 'vegetation_grown',
      id: veg.id,
      growth_stage: veg.growth_stage + 1,
    });
  }

  // Spread: fetch all mature, process in chunks to avoid blocking event loop
  let newSpawns = 0;

  const matureGrass = await prisma.world_vegetation.findMany({
    where: { growth_stage: 4, type: 'grass', health: { gte: 50 } },
    select: { id: true, x: true, z: true },
  });

  // Filter candidates in-memory (instant — no DB)
  const grassCandidates = matureGrass.filter(g => canSpread(g.id) && Math.random() <= 0.10);

  // Process in chunks of 100, yielding event loop between chunks
  const processChunk = async <T>(items: T[], fn: (item: T) => Promise<void>, chunkSize = 100): Promise<void> => {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      for (const item of chunk) await fn(item);
      if (i + chunkSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 0)); // Yield to event loop
      }
    }
  };

  await processChunk(grassCandidates, async (g) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 8;
    const newX = g.x + Math.cos(angle) * dist;
    const newZ = g.z + Math.sin(angle) * dist;

    const nearby = await prisma.world_vegetation.count({
      where: { x: { gte: newX - 1.5, lte: newX + 1.5 }, z: { gte: newZ - 1.5, lte: newZ + 1.5 } },
    });
    if (nearby > 0) { recordSpreadFailure(g.id); return; }

    const newVeg = await prisma.world_vegetation.create({
      data: { x: newX, z: newZ, type: 'grass', growth_stage: 0, health: 100 },
    });
    recordSpreadSuccess(g.id);
    try { const { adjustVegCount } = require('./critters'); adjustVegCount('grass', 1); } catch {}

    await prisma.vegetation_log.create({ data: {
      veg_id: newVeg.id, veg_type: 'grass', event: 'spawned', x: newX, z: newZ,
    } }).catch(() => {});

    broadcastNearby(newX, newZ, 200, {
      type: 'vegetation_spawned',
      id: newVeg.id, x: newX, z: newZ, vegType: 'grass', growth_stage: 0, health: 100,
    });
    newSpawns++;
  });

  // Trees drop seeds — mature trees have 5% chance to spawn a sapling nearby
  // Seeds fall further than grass (5-10m) and need more space (3m minimum gap)
  // Random ordering ensures rare species (pine) get a fair chance alongside common ones (oak)
  const matureTrees = await prisma.world_vegetation.findMany({
    where: { growth_stage: 4, type: { startsWith: 'tree_' }, health: { gte: 50 } },
    select: { id: true, x: true, z: true, type: true },
  });
  const treeCandidates = matureTrees.filter(t => canSpread(t.id) && Math.random() <= 0.05);

  await processChunk(treeCandidates, async (tree) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * 5;
    const newX = tree.x + Math.cos(angle) * dist;
    const newZ = tree.z + Math.sin(angle) * dist;

    const nearbyTrees = await prisma.world_vegetation.count({
      where: {
        x: { gte: newX - 3, lte: newX + 3 },
        z: { gte: newZ - 3, lte: newZ + 3 },
        type: { startsWith: 'tree_' },
      },
    });
    if (nearbyTrees > 0) { recordSpreadFailure(tree.id); return; }

    const nearbyAll = await prisma.world_vegetation.count({
      where: { x: { gte: newX - 1, lte: newX + 1 }, z: { gte: newZ - 1, lte: newZ + 1 } },
    });
    if (nearbyAll > 2) { recordSpreadFailure(tree.id); return; }

    const newTree = await prisma.world_vegetation.create({
      data: { x: newX, z: newZ, type: tree.type, growth_stage: 0, health: 100 },
    });
    recordSpreadSuccess(tree.id);
    try { const { adjustVegCount } = require('./critters'); adjustVegCount(tree.type, 1); } catch {}

    await prisma.vegetation_log.create({ data: {
      veg_id: newTree.id, veg_type: tree.type, event: 'spawned', x: newX, z: newZ,
    } }).catch(() => {});

    broadcastNearby(newX, newZ, 200, {
      type: 'vegetation_spawned',
      id: newTree.id, x: newX, z: newZ, vegType: tree.type, growth_stage: 0, health: 100,
    });
    newSpawns++;
  });

  const matureBushes = await prisma.world_vegetation.findMany({
    where: { growth_stage: 4, type: 'bush', health: { gte: 50 } },
    select: { id: true, x: true, z: true },
  });
  const bushCandidates = matureBushes.filter(b => canSpread(b.id) && Math.random() <= 0.05);

  await processChunk(bushCandidates, async (bush) => {
    const bAngle = Math.random() * Math.PI * 2;
    const bDist = 2 + Math.random() * 4;
    const newX = bush.x + Math.cos(bAngle) * bDist;
    const newZ = bush.z + Math.sin(bAngle) * bDist;

    const nearby = await prisma.world_vegetation.count({
      where: { x: { gte: newX - 2, lte: newX + 2 }, z: { gte: newZ - 2, lte: newZ + 2 } },
    });
    if (nearby > 0) { recordSpreadFailure(bush.id); return; }

    const newBush = await prisma.world_vegetation.create({
      data: { x: newX, z: newZ, type: 'bush', growth_stage: 0, health: 100 },
    });
    recordSpreadSuccess(bush.id);
    try { const { adjustVegCount } = require('./critters'); adjustVegCount('bush', 1); } catch {}

    await prisma.vegetation_log.create({ data: {
      veg_id: newBush.id, veg_type: 'bush', event: 'spawned', x: newX, z: newZ,
    } }).catch(() => {});

    broadcastNearby(newX, newZ, 200, {
      type: 'vegetation_spawned',
      id: newBush.id, x: newX, z: newZ, vegType: 'bush', growth_stage: 0, health: 100,
    });
    newSpawns++;
  });

  // Log tick stats
  const totalVeg = await prisma.world_vegetation.count();
  const connectedPlayers = Array.from(players.values()).filter(p => p.ws?.readyState === WebSocket.OPEN).length;
  // Count actual spawns by tracking creates above (grass + trees + bushes)
  const dormant = spreadCooldowns.size;
  console.log(`[Vegetation] Tick: ${grownVeg.length} grew, ${newSpawns} spawned (from ${matureGrass.length} grass + ${matureTrees.length} trees + ${matureBushes.length} bushes), ${totalVeg} total, ${dormant} on cooldown, ${connectedPlayers} players online`);
};

// ── Trampling ──

const checkTrampling = async (x: number, z: number): Promise<void> => {
  const nearbyVeg = await prisma.world_vegetation.findMany({
    where: {
      x: { gte: x - 0.5, lte: x + 0.5 },
      z: { gte: z - 0.5, lte: z + 0.5 },
      health: { gt: 0 },
    },
  });

  for (const veg of nearbyVeg) {
    // Grass: 5 walks to kill, bushes: ~7, trees: ~15 (tougher but still trampleable for paths)
    const dmg = veg.type === 'grass' ? 20 : veg.type === 'bush' ? 15 : 7; // trees take 3x more walks
    const newHealth = Math.max(0, veg.health - dmg);
    // Growth stage regresses with health: 80-100=4, 60-79=3, 40-59=2, 20-39=1, 1-19=0
    const newStage = newHealth <= 0 ? 0 : Math.min(4, Math.floor(newHealth / 20));
    const stageChanged = newStage !== veg.growth_stage;

    await prisma.world_vegetation.update({
      where: { id: veg.id },
      data: { health: newHealth, growth_stage: newStage },
    });

    if (newHealth <= 0) {
      await prisma.vegetation_log.create({ data: {
        veg_id: veg.id, veg_type: veg.type, event: 'trampled', x: veg.x, z: veg.z,
        detail: `health: ${veg.health}→0 (killed)`,
      } }).catch(() => {});
      broadcastNearby(veg.x, veg.z, 200, { type: 'vegetation_died', id: veg.id });
      try { const { adjustVegCount } = require('./critters'); adjustVegCount(veg.type, -1); } catch {}
      resetCooldownsNear(veg.x, veg.z, 10).catch(() => {});
    } else if (stageChanged) {
      broadcastNearby(veg.x, veg.z, 200, { type: 'vegetation_grown', id: veg.id, growth_stage: newStage });
    }
  }
};

// ── Init ──

const initVegetationSystem = (): void => {
  // Growth tick every 30s (reduced from 5s — was causing connection drops from DB load)
  setInterval(() => {
    const start = Date.now();
    vegetationTick()
      .then(() => {
        try { const { recordPerfSample } = require('./critters'); recordPerfSample('vegetationTick', Date.now() - start); } catch (e) { console.error('[Vegetation] Perf error:', e); }
      })
      .catch((err) => console.error('[Vegetation] Tick error:', err));
  }, 30000);

  // World time broadcast every 10s
  setInterval(() => {
    broadcastAll({ type: 'world_time', hour: getGameHour(), day: getGameDay() });
  }, 10000);

  console.log('[Vegetation] System initialized (growth tick: 30s, spread: 10% grass / 3% tree / 5% bush, daytime only)');
};

export { initVegetationSystem, getGameHour, getGameDay, broadcastNearby, checkTrampling, resetCooldownsNear };
