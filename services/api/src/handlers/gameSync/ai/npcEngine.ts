// ┌──────────────────────────────────────────┐
// │ NPC Engine — Wires behavior tree + Grok │
// │ into the game-sync tick loop            │
// └──────────────────────────────────────────┘

import { WebSocket } from 'ws';

import grokAdapter from '../../../../../../core/adapters/grok';
import Data from '../../../../../../core/data';

import { players, broadcastAll } from '../combat';
import type { PlayerSyncState } from '../combat';
import { evaluateBehavior } from './behaviorTree';
import { buildPrompt, parseGrokResponse, applyGrokResponse } from './grokBrain';
import type { NPCBrain } from './behaviorTree';

// ── Active NPC brains (keyed by character ID) ──
const activeNPCs = new Map<string, NPCBrain>();
// ── NPC sync states (keyed by NPC character ID, separate from player states) ──
const npcStates = new Map<string, PlayerSyncState>();

// Grok interval by NPC tier (ms)
const GROK_INTERVALS: Record<string, number> = {
  peasant_levy: 30_000,
  militia_swordsman: 20_000,
  man_at_arms: 15_000,
  veteran_knight: 10_000,
  elite_champion: 5_000,
  crossbowman: 20_000,
  shield_bearer: 15_000,
};

/** Register all of a player's recruits into the NPC engine. */
const registerPlayerNPCs = async (commanderUserId: string): Promise<void> => {
  const recruits = await Data.playerCharacter.findRecruitsByCommander(commanderUserId);
  const commander = players.get(commanderUserId);

  for (const recruit of recruits) {
    if (!recruit.is_alive || activeNPCs.has(recruit.id)) continue;

    const brain: NPCBrain = {
      characterId: recruit.id,
      commanderUserId,
      name: recruit.name,
      humor: recruit.trait_humor,
      obedience: recruit.trait_obedience,
      bravery: recruit.trait_bravery,
      curiosity: recruit.trait_curiosity,
      greed: recruit.trait_greed,
      aggressionNature: recruit.trait_aggression,
      verbosity: recruit.trait_verbosity,
      mood: recruit.mood,
      fear: recruit.fear,
      loyalty: recruit.loyalty,
      familiarity: recruit.familiarity,
      attraction: recruit.attraction,
      warmth: recruit.warmth,
      respect: recruit.respect,
      fatigue: recruit.fatigue,
      hunger: recruit.hunger,
      procreationDrive: recruit.procreation_drive,
      aggression: recruit.bw_aggression,
      defense: recruit.bw_defense,
      counterAttack: recruit.bw_counter_attack,
      flankTendency: recruit.bw_flank_tendency,
      flankDirection: recruit.bw_flank_direction,
      retreatThreshold: recruit.bw_retreat_threshold,
      pursuit: recruit.bw_pursuit,
      groupCohesion: recruit.bw_group_cohesion,
      commanderProtection: recruit.bw_commander_protection,
      selfPreservation: recruit.bw_self_preservation,
      agenda: recruit.ai_agenda || 'follow_commander',
      targetId: recruit.ai_target_id || null,
      lastGrokCall: 0,
      grokIntervalMs: GROK_INTERVALS[recruit.npc_type || ''] || 20_000,
      situationLog: recruit.ai_memories ? JSON.parse(recruit.ai_memories) : [],
      agendaLocked: false,
      formationPos: null,
      formationRot: null,
      formationType: null,
      formationAction: null,
      marchDirection: null,
      leaderId: null, // Set in second pass after all units registered
    };

    activeNPCs.set(recruit.id, brain);

    // Create a PlayerSyncState for the NPC (so combat resolution can find them)
    const spawnPos: [number, number, number] = commander
      ? [commander.pos[0] + (Math.random() - 0.5) * 8 + (Math.random() > 0.5 ? 2 : -2), commander.pos[1], commander.pos[2] + (Math.random() - 0.5) * 8 + (Math.random() > 0.5 ? 2 : -2)]
      : [recruit.spawn_x, recruit.spawn_y, recruit.spawn_z];

    const npcState: PlayerSyncState = {
      userId: recruit.id, // Use character ID as the "user" key for NPCs
      characterId: recruit.id,
      username: recruit.name,
      ws: null as unknown as WebSocket, // NPCs don't have their own WebSocket
      pos: spawnPos,
      rot: 0,
      action: 'idle',
      actionStartTime: Date.now(),
      hp: recruit.max_health,
      maxHp: recruit.max_health,
      stamina: recruit.max_stamina,
      maxStamina: recruit.max_stamina,
      strength: recruit.strength,
      defense: recruit.defense,
      lastDamageTime: 0,
      isDead: false,
      spawnX: recruit.spawn_x,
      spawnY: recruit.spawn_y,
      spawnZ: recruit.spawn_z,
    };

    npcStates.set(recruit.id, npcState);
    // Also add to the main players map so combat resolution can find them
    players.set(recruit.id, npcState);

    console.log(`[NPC] Registered ${recruit.name} (${recruit.npc_type}, ${recruit.rank}) for commander ${commanderUserId}`);
  }

  // ── Second pass: assign chain of command (leaderId) ──
  // Re-fetch from DB to get latest ranks after promotions
  await rebuildChainOfCommand(commanderUserId);
};

/** Rebuild leaderId for all active NPCs of a commander. Call after promotions/deaths/recruits. */
const rebuildChainOfCommand = async (commanderUserId: string): Promise<void> => {
  const recruits = await Data.playerCharacter.findRecruitsByCommander(commanderUserId);
  const centurion = recruits.find((r) => r.rank === 'centurion');

  for (const recruit of recruits) {
    const brain = activeNPCs.get(recruit.id);
    if (!brain) continue;

    if (recruit.rank === 'soldier') {
      const sergeant = recruits.find((r) =>
        r.rank === 'sergeant' && r.maniple_id === recruit.maniple_id && r.squad_id === recruit.squad_id
      );
      const decurion = recruits.find((r) =>
        r.rank === 'decurion' && r.maniple_id === recruit.maniple_id
      );
      brain.leaderId = sergeant?.id || decurion?.id || centurion?.id || commanderUserId;
    } else if (recruit.rank === 'sergeant') {
      const decurion = recruits.find((r) =>
        r.rank === 'decurion' && r.maniple_id === recruit.maniple_id
      );
      brain.leaderId = decurion?.id || centurion?.id || commanderUserId;
    } else if (recruit.rank === 'decurion') {
      brain.leaderId = centurion?.id || commanderUserId;
    } else if (recruit.rank === 'centurion') {
      brain.leaderId = commanderUserId;
    }
  }
};

/** Unregister all NPCs for a disconnecting player. */
const unregisterPlayerNPCs = (commanderUserId: string): void => {
  const toRemove: string[] = [];
  for (const [id, brain] of activeNPCs) {
    if (brain.commanderUserId === commanderUserId) {
      toRemove.push(id);
    }
  }
  for (const id of toRemove) {
    activeNPCs.delete(id);
    npcStates.delete(id);
    players.delete(id);
    broadcastAll({ type: 'player_left', id });
  }
  if (toRemove.length > 0) {
    console.log(`[NPC] Unregistered ${toRemove.length} NPCs for ${commanderUserId}`);
  }
};

// ┌──────────────────────────────────────────┐
// │ Behavior Tree Tick (every 500ms)         │
// └──────────────────────────────────────────┘

let auditTickCounter = 0;

setInterval(() => {
  auditTickCounter++;
  const shouldLog = auditTickCounter % 20 === 0; // Log every 10 seconds (20 * 500ms)

  for (const [id, brain] of activeNPCs) {
    const npc = npcStates.get(id);
    if (!npc || npc.isDead) continue;

    // Don't override if NPC is mid-attack animation
    if ((npc.action === 'attack_light' || npc.action === 'attack_heavy') &&
        Date.now() - npc.actionStartTime < 600) continue;

    const decision = evaluateBehavior(brain, npc, players, activeNPCs);

    if (shouldLog) {
      console.log(`[NPC:${brain.name}] agenda=${brain.agenda} action=${decision.action} | ${decision.reason}`);
    }

    // Apply decision
    if (decision.faceTarget) {
      const target = players.get(decision.faceTarget);
      if (target) {
        const dx = target.pos[0] - npc.pos[0];
        const dz = target.pos[2] - npc.pos[2];
        npc.rot = Math.atan2(dx, dz) * 180 / Math.PI;
      }
    }

    if (decision.moveTarget) {
      const dx = decision.moveTarget[0] - npc.pos[0];
      const dz = decision.moveTarget[2] - npc.pos[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.5) {
        const speed = decision.action === 'run' ? 2.5 : 1.25;
        npc.pos = [
          npc.pos[0] + (dx / dist) * speed,
          decision.moveTarget[1],
          npc.pos[2] + (dz / dist) * speed,
        ];
        if (!decision.faceTarget) {
          npc.rot = Math.atan2(dx, dz) * 180 / Math.PI;
        }
      }
    }

    // ── Unit separation: push apart if too close to allies ──
    const MIN_SEPARATION = 2.0;
    let sepX = 0;
    let sepZ = 0;
    for (const [otherId, otherBrain] of activeNPCs) {
      if (otherId === id) continue;
      if (otherBrain.commanderUserId !== brain.commanderUserId) continue;
      const otherNpc = npcStates.get(otherId);
      if (!otherNpc) continue;
      const sdx = npc.pos[0] - otherNpc.pos[0];
      const sdz = npc.pos[2] - otherNpc.pos[2];
      const sDist = Math.sqrt(sdx * sdx + sdz * sdz);
      if (sDist < MIN_SEPARATION && sDist > 0.01) {
        const pushStrength = (MIN_SEPARATION - sDist) / MIN_SEPARATION * 0.5;
        sepX += (sdx / sDist) * pushStrength;
        sepZ += (sdz / sDist) * pushStrength;
      }
    }
    // Also push away from commander
    const cmdState = players.get(brain.commanderUserId);
    if (cmdState) {
      const cdx = npc.pos[0] - cmdState.pos[0];
      const cdz = npc.pos[2] - cmdState.pos[2];
      const cDist = Math.sqrt(cdx * cdx + cdz * cdz);
      if (cDist < MIN_SEPARATION && cDist > 0.01) {
        const pushStrength = (MIN_SEPARATION - cDist) / MIN_SEPARATION * 0.5;
        sepX += (cdx / cDist) * pushStrength;
        sepZ += (cdz / cDist) * pushStrength;
      }
    }
    if (sepX !== 0 || sepZ !== 0) {
      npc.pos = [npc.pos[0] + sepX, npc.pos[1], npc.pos[2] + sepZ];
    }

    // Execute combat actions
    if (decision.action === 'attack_light' || decision.action === 'attack_heavy') {
      npc.action = decision.action;
      npc.actionStartTime = Date.now();
      const staminaCost = decision.action === 'attack_heavy' ? 25 : 10;
      if (npc.stamina >= staminaCost) {
        npc.stamina -= staminaCost;
        broadcastAll({ type: 'npc_combat_action', id, action: decision.action, target_id: decision.faceTarget });
        // Combat resolution happens in the main combat module via resolveAttack
      }
    } else if (decision.action === 'dodge' && npc.stamina >= 20) {
      npc.stamina -= 20;
      npc.action = 'dodge';
      npc.actionStartTime = Date.now();
    } else {
      npc.action = decision.action;
    }

    // Broadcast NPC position/state to all clients
    broadcastAll({
      type: 'npc_update',
      id,
      pos: npc.pos,
      rot: npc.rot,
      action: npc.action,
      hp: npc.hp,
      maxHp: npc.maxHp,
      stamina: npc.stamina,
      mood: brain.mood,
    });
  }
}, 500);

// ┌──────────────────────────────────────────┐
// │ Grok Brain Tick (every 1s, staggered)    │
// └──────────────────────────────────────────┘

setInterval(async () => {
  const now = Date.now();

  for (const [id, brain] of activeNPCs) {
    // Check if it's time for this NPC to think
    if (now - brain.lastGrokCall < brain.grokIntervalMs) continue;

    const npc = npcStates.get(id);
    if (!npc || npc.isDead) continue;

    brain.lastGrokCall = now;

    // Build situation report
    const commander = players.get(brain.commanderUserId);
    const distToCommander = commander
      ? Math.sqrt((npc.pos[0] - commander.pos[0]) ** 2 + (npc.pos[2] - commander.pos[2]) ** 2).toFixed(1)
      : 'unknown';

    const nearbyEnemies: string[] = [];
    const nearbyAllies: string[] = [];
    for (const [pid, p] of players) {
      if (pid === id || pid === brain.commanderUserId || p.isDead) continue;
      const dx = npc.pos[0] - p.pos[0];
      const dz = npc.pos[2] - p.pos[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 15) continue;

      // Check if this is a friendly NPC (same commander)
      const otherBrain = activeNPCs.get(pid);
      if (otherBrain && otherBrain.commanderUserId === brain.commanderUserId) {
        nearbyAllies.push(`${p.username} (ally, ${dist.toFixed(1)}m)`);
        continue;
      }

      nearbyEnemies.push(`${p.username} at ${dist.toFixed(1)}m (HP: ${p.hp}/${p.maxHp})`);
    }

    const situation = [
      `My HP: ${npc.hp}/${npc.maxHp}, Stamina: ${npc.stamina}/${npc.maxStamina}`,
      `Distance to commander: ${distToCommander}m`,
      `Current action: ${npc.action}, Agenda: ${brain.agenda}`,
      nearbyAllies.length > 0 ? `Nearby allies: ${nearbyAllies.join(', ')}` : '',
      nearbyEnemies.length > 0 ? `ENEMIES NEARBY: ${nearbyEnemies.join(', ')}` : 'The area is peaceful. No enemies in sight.',
    ].filter(Boolean).join('\n');

    // Load instructions from DB (may have been updated by player)
    const dbChar = await Data.playerCharacter.findById(id).catch(() => null);
    const instructions = dbChar?.ai_instructions || 'Follow and protect your commander.';

    const prompt = buildPrompt(brain, situation).replace('---\n---', `---\n${instructions}\n---`);

    try {
      const grokResponse = await grokAdapter.chatCompletion(
        prompt,
        [{ role: 'user', content: 'Evaluate the current situation and respond.' }],
        'grok-3-mini',
        300, // Short response
      );

      const responseText = grokResponse.text || '';
      const parsed = parseGrokResponse(responseText, brain);

      // Apply weight changes
      await applyGrokResponse(brain, parsed);

      // If NPC has something to say, broadcast it
      if (parsed.say) {
        broadcastAll({
          type: 'npc_say',
          id,
          text: parsed.say,
          emotion: brain.mood > 70 ? 'happy' : brain.mood < 30 ? 'sad' : brain.fear > 50 ? 'fearful' : 'neutral',
        });
      }
    } catch (err) {
      // Grok call failed — that's fine, keep using existing weights
      console.error(`[NPC] Grok call failed for ${brain.name}:`, (err as Error).message);
    }
  }
}, 1000); // Check every second, but each NPC has its own interval

// ┌──────────────────────────────────────────┐
// │ Needs Tick (every 30s)                   │
// └──────────────────────────────────────────┘

setInterval(() => {
  for (const [, brain] of activeNPCs) {
    brain.fatigue = Math.min(100, brain.fatigue + 1);
    brain.hunger = Math.min(100, brain.hunger + 1);
    // Mood degrades slightly when needs are high
    if (brain.fatigue > 70 || brain.hunger > 70) {
      brain.mood = Math.max(0, brain.mood - 1);
    }
  }
}, 30_000);

export { registerPlayerNPCs, unregisterPlayerNPCs, rebuildChainOfCommand, activeNPCs, npcStates };
