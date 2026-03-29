// ┌──────────────────────────────────────────┐
// │ Vegetation & World Time System           │
// └──────────────────────────────────────────┘

import prisma from '../../../../../core/adapters/prisma';
import { broadcastAll, players } from './combat';
import { WebSocket } from 'ws';

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
      last_growth: { lt: new Date(now.getTime() - 60000) }, // 60s cooldown
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

  // Spread: every mature grass has a chance to spawn adjacent — density is the only cap
  let newSpawns = 0;
  const matureGrass = await prisma.world_vegetation.findMany({
    where: { growth_stage: 4, type: 'grass', health: { gte: 50 } },
  });

  for (const g of matureGrass) {
    if (Math.random() > 0.10) continue; // 10% chance per tick
    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 8; // 2-10m from parent
    const newX = g.x + Math.cos(angle) * dist;
    const newZ = g.z + Math.sin(angle) * dist;

    // Don't spawn too close to existing
    const nearby = await prisma.world_vegetation.count({
      where: { x: { gte: newX - 1.5, lte: newX + 1.5 }, z: { gte: newZ - 1.5, lte: newZ + 1.5 } },
    });
    if (nearby > 0) continue;

    const newVeg = await prisma.world_vegetation.create({
      data: { x: newX, z: newZ, type: 'grass', growth_stage: 0, health: 100 },
    });

    await prisma.vegetation_log.create({ data: {
      veg_id: newVeg.id, veg_type: 'grass', event: 'spawned', x: newX, z: newZ,
    } }).catch(() => {});

    broadcastNearby(newX, newZ, 200, {
      type: 'vegetation_spawned',
      id: newVeg.id, x: newX, z: newZ, vegType: 'grass', growth_stage: 0, health: 100,
    });
    newSpawns++;
  }

  // Trees drop seeds — mature trees have 5% chance to spawn a sapling nearby
  // Seeds fall further than grass (5-10m) and need more space (3m minimum gap)
  // Random ordering ensures rare species (pine) get a fair chance alongside common ones (oak)
  const matureTrees = await prisma.$queryRaw<{ id: number; x: number; z: number; type: string }[]>`
    SELECT id, x, z, type FROM world_vegetation
    WHERE growth_stage = 4 AND type LIKE 'tree_%' AND health >= 50
    ORDER BY RAND()
  `;

  for (const tree of matureTrees) {
    if (Math.random() > 0.05) continue; // 5% chance per tick
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * 5; // 5-10m from parent
    const newX = tree.x + Math.cos(angle) * dist;
    const newZ = tree.z + Math.sin(angle) * dist;

    // Trees need more space — 3m minimum from any other tree
    const nearbyTrees = await prisma.world_vegetation.count({
      where: {
        x: { gte: newX - 3, lte: newX + 3 },
        z: { gte: newZ - 3, lte: newZ + 3 },
        type: { startsWith: 'tree_' },
      },
    });
    if (nearbyTrees > 0) continue;

    // Don't spawn on top of dense grass either
    const nearbyAll = await prisma.world_vegetation.count({
      where: { x: { gte: newX - 1, lte: newX + 1 }, z: { gte: newZ - 1, lte: newZ + 1 } },
    });
    if (nearbyAll > 2) continue;

    const newTree = await prisma.world_vegetation.create({
      data: { x: newX, z: newZ, type: tree.type, growth_stage: 0, health: 100 },
    });

    await prisma.vegetation_log.create({ data: {
      veg_id: newTree.id, veg_type: tree.type, event: 'spawned', x: newX, z: newZ,
    } }).catch(() => {});

    broadcastNearby(newX, newZ, 200, {
      type: 'vegetation_spawned',
      id: newTree.id, x: newX, z: newZ, vegType: tree.type, growth_stage: 0, health: 100,
    });
    newSpawns++;
  }

  // Bushes also spread — 5% chance, 2-4m distance
  const matureBushes = await prisma.world_vegetation.findMany({
    where: { growth_stage: 4, type: 'bush', health: { gte: 50 } },
  });

  for (const bush of matureBushes) {
    if (Math.random() > 0.05) continue; // 5% chance per tick
    const bAngle = Math.random() * Math.PI * 2;
    const bDist = 2 + Math.random() * 4; // 2-6m from parent
    const newX = bush.x + Math.cos(bAngle) * bDist;
    const newZ = bush.z + Math.sin(bAngle) * bDist;

    const nearby = await prisma.world_vegetation.count({
      where: { x: { gte: newX - 2, lte: newX + 2 }, z: { gte: newZ - 2, lte: newZ + 2 } },
    });
    if (nearby > 0) continue;

    const newBush = await prisma.world_vegetation.create({
      data: { x: newX, z: newZ, type: 'bush', growth_stage: 0, health: 100 },
    });

    await prisma.vegetation_log.create({ data: {
      veg_id: newBush.id, veg_type: 'bush', event: 'spawned', x: newX, z: newZ,
    } }).catch(() => {});

    broadcastNearby(newX, newZ, 200, {
      type: 'vegetation_spawned',
      id: newBush.id, x: newX, z: newZ, vegType: 'bush', growth_stage: 0, health: 100,
    });
    newSpawns++;
  }

  // Log tick stats
  const totalVeg = await prisma.world_vegetation.count();
  const connectedPlayers = Array.from(players.values()).filter(p => p.ws?.readyState === WebSocket.OPEN).length;
  // Count actual spawns by tracking creates above (grass + trees + bushes)
  console.log(`[Vegetation] Tick: ${grownVeg.length} grew, ${newSpawns} spawned (from ${matureGrass.length} grass + ${matureTrees.length} trees + ${matureBushes.length} bushes), ${totalVeg} total, ${connectedPlayers} players online`);
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
    } else if (stageChanged) {
      broadcastNearby(veg.x, veg.z, 200, { type: 'vegetation_grown', id: veg.id, growth_stage: newStage });
    }
  }
};

// ── Init ──

const initVegetationSystem = (): void => {
  // Growth tick every 30s (reduced from 5s — was causing connection drops from DB load)
  setInterval(() => {
    vegetationTick().catch((err) => console.error('[Vegetation] Tick error:', err));
  }, 30000);

  // World time broadcast every 10s
  setInterval(() => {
    broadcastAll({ type: 'world_time', hour: getGameHour(), day: getGameDay() });
  }, 10000);

  console.log('[Vegetation] System initialized (growth tick: 30s, spread: 10% grass / 3% tree / 5% bush, daytime only)');
};

export { initVegetationSystem, getGameHour, getGameDay, broadcastNearby, checkTrampling };
