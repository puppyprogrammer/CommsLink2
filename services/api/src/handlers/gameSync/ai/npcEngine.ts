// ┌──────────────────────────────────────────┐
// │ NPC Engine — Wires behavior tree + Grok │
// │ into the game-sync tick loop            │
// └──────────────────────────────────────────┘

import { WebSocket } from 'ws';

import grokAdapter from '../../../../../../core/adapters/grok';
import Data from '../../../../../../core/data';

import { players, broadcast, broadcastAll, loadWeaponRange, loadEquipment } from '../combat';
import type { PlayerSyncState } from '../combat';
import { evaluateBehavior, setArmyCountCache, isEnemy } from './behaviorTree';
import { buildPrompt, parseGrokResponse, applyGrokResponse } from './grokBrain';
import type { NPCBrain } from './behaviorTree';

// ── Active NPC brains (keyed by character ID) ──
const activeNPCs = new Map<string, NPCBrain>();
// ── NPC sync states (keyed by NPC character ID, separate from player states) ──
const npcStates = new Map<string, PlayerSyncState>();
// ── Recent speech per army (keyed by commanderUserId) — nearby NPCs can hear and respond ──
const armySpeechLog = new Map<string, { name: string; text: string; time: number }[]>();

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
      moveToTarget: null, moveToFacing: null, holdPosition: null, holdFacing: null,
      leaderId: null, // Set in second pass after all units registered
      rank: recruit.rank || 'soldier',
      squadIndex: 0,
      armyBlockIndex: 0, // Set in rebuildChainOfCommand
      weaponDrawn: false,
    };

    activeNPCs.set(recruit.id, brain);

    // Create a PlayerSyncState for the NPC (so combat resolution can find them)
    const spawnPos: [number, number, number] = commander
      ? [commander.pos[0] + (Math.random() - 0.5) * 8 + (Math.random() > 0.5 ? 2 : -2), commander.pos[1], commander.pos[2] + (Math.random() - 0.5) * 8 + (Math.random() > 0.5 ? 2 : -2)]
      : [recruit.spawn_x, recruit.spawn_y, recruit.spawn_z];

    // Load equipment BEFORE creating state
    const gear = await loadEquipment(recruit.id);

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
      weaponRange: gear.range,
      weaponName: gear.name,
      equipped: gear.equipped,
    };

    npcStates.set(recruit.id, npcState);
    // Also add to the main players map so combat resolution can find them
    players.set(recruit.id, npcState);

    // Broadcast NPC spawn to other players — include per-player relation for name colors
    const { WebSocket } = require('ws');
    for (const [pid, p] of players) {
      if (pid === commanderUserId || !p.ws || p.ws.readyState !== WebSocket.OPEN) continue;
      p.ws.send(JSON.stringify({
        type: 'player_joined',
        id: recruit.id,
        username: recruit.name,
        pos: spawnPos,
        rot: 0,
        hp: npcState.hp,
        maxHp: npcState.maxHp,
        isNpc: true,
        equipped: gear.equipped,
        commanderId: commanderUserId,
        relation: isEnemy(pid, commanderUserId) ? 'enemy' : 'neutral',
      }));
    }

    console.log(`[NPC] Registered ${recruit.name} (${recruit.npc_type}, ${recruit.rank}) for commander ${commanderUserId}`);
  }

  // ── Second pass: assign chain of command (leaderId) ──
  // Re-fetch from DB to get latest ranks after promotions
  await rebuildChainOfCommand(commanderUserId);
};

/** Rebuild leaderId and squadIndex for all active NPCs of a commander. Call after promotions/deaths/recruits. */
const rebuildChainOfCommand = async (commanderUserId: string): Promise<void> => {
  const recruits = await Data.playerCharacter.findRecruitsByCommander(commanderUserId);
  const centurion = recruits.find((r) => r.rank === 'centurion');

  // Track squad indexes per leader for formation positioning
  const leaderSquadCount = new Map<string, number>();

  for (const recruit of recruits) {
    const brain = activeNPCs.get(recruit.id);
    if (!brain) continue;

    brain.rank = recruit.rank || 'soldier';

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

    // Assign sequential index within the group following the same leader
    const key = brain.leaderId || commanderUserId;
    const idx = leaderSquadCount.get(key) || 0;
    brain.squadIndex = idx;
    leaderSquadCount.set(key, idx + 1);
  }

  // ── Assign armyBlockIndex: squad-grouped ordering for unified block ──
  // Centurion first, then each maniple as a group (decurion → squad A [sergeant + soldiers] → squad B)
  // This keeps each squad together as a tight cluster in the formation.
  const active = recruits.filter((r) => activeNPCs.has(r.id));
  const ordered: typeof active = [];

  // 1. Centurion first
  const cent = active.find((r) => r.rank === 'centurion');
  if (cent) ordered.push(cent);

  // 2. Group by maniple, then by squad within each maniple
  const manipleIds = [...new Set(active.map((r) => r.maniple_id || 0))].sort();
  for (const mId of manipleIds) {
    const maniple = active.filter((r) => (r.maniple_id || 0) === mId && r.rank !== 'centurion');
    // Decurion first
    const dec = maniple.find((r) => r.rank === 'decurion');
    if (dec) ordered.push(dec);
    // Then each squad: sergeant + soldiers
    const squadIds = [...new Set(maniple.map((r) => r.squad_id || ''))].sort();
    for (const sId of squadIds) {
      const squad = maniple.filter((r) => (r.squad_id || '') === sId && r.rank !== 'decurion');
      const sgt = squad.find((r) => r.rank === 'sergeant');
      if (sgt) ordered.push(sgt);
      const soldiers = squad.filter((r) => r.rank === 'soldier');
      ordered.push(...soldiers);
    }
  }

  // Any stragglers not caught above
  for (const r of active) {
    if (!ordered.includes(r)) ordered.push(r);
  }

  for (let i = 0; i < ordered.length; i++) {
    const brain = activeNPCs.get(ordered[i].id);
    if (brain) brain.armyBlockIndex = i;
  }
};

/** Register a single new recruit into the live NPC engine. Call after purchase. */
const registerSingleNPC = async (commanderUserId: string, recruitId: string): Promise<void> => {
  if (activeNPCs.has(recruitId)) return; // Already registered

  const recruit = await Data.playerCharacter.findById(recruitId);
  if (!recruit || !recruit.is_alive) return;

  const commander = players.get(commanderUserId);
  if (!commander) return; // Commander not online — NPC will register on next connect

  const GROK_INTERVALS_LOCAL: Record<string, number> = {
    peasant_levy: 30_000, militia_swordsman: 20_000, man_at_arms: 15_000,
    veteran_knight: 10_000, elite_champion: 5_000, crossbowman: 20_000, shield_bearer: 15_000,
  };

  const brain: NPCBrain = {
    characterId: recruit.id, commanderUserId, name: recruit.name,
    humor: recruit.trait_humor, obedience: recruit.trait_obedience, bravery: recruit.trait_bravery,
    curiosity: recruit.trait_curiosity, greed: recruit.trait_greed, aggressionNature: recruit.trait_aggression,
    verbosity: recruit.trait_verbosity, mood: recruit.mood, fear: recruit.fear, loyalty: recruit.loyalty,
    familiarity: recruit.familiarity, attraction: recruit.attraction, warmth: recruit.warmth, respect: recruit.respect,
    fatigue: recruit.fatigue, hunger: recruit.hunger, procreationDrive: recruit.procreation_drive,
    aggression: recruit.bw_aggression, defense: recruit.bw_defense, counterAttack: recruit.bw_counter_attack,
    flankTendency: recruit.bw_flank_tendency, flankDirection: recruit.bw_flank_direction,
    retreatThreshold: recruit.bw_retreat_threshold, pursuit: recruit.bw_pursuit,
    groupCohesion: recruit.bw_group_cohesion, commanderProtection: recruit.bw_commander_protection,
    selfPreservation: recruit.bw_self_preservation, agenda: recruit.ai_agenda || 'follow_commander',
    targetId: recruit.ai_target_id || null, lastGrokCall: 0,
    grokIntervalMs: GROK_INTERVALS_LOCAL[recruit.npc_type || ''] || 20_000,
    situationLog: [], agendaLocked: false, formationPos: null, formationRot: null,
    formationType: null, formationAction: null, marchDirection: null, moveToTarget: null, moveToFacing: null, holdPosition: null, holdFacing: null, leaderId: null,
    rank: recruit.rank || 'soldier', squadIndex: 0, armyBlockIndex: 0, weaponDrawn: false,
  };

  activeNPCs.set(recruit.id, brain);

  const spawnPos: [number, number, number] = [
    commander.pos[0] + (Math.random() - 0.5) * 6,
    commander.pos[1],
    commander.pos[2] + (Math.random() - 0.5) * 6,
  ];

  const gear = await loadEquipment(recruit.id);
  const npcState: PlayerSyncState = {
    userId: recruit.id, characterId: recruit.id, username: recruit.name,
    ws: null as unknown as WebSocket, pos: spawnPos, rot: 0, action: 'idle',
    actionStartTime: Date.now(), hp: recruit.max_health, maxHp: recruit.max_health,
    stamina: recruit.max_stamina, maxStamina: recruit.max_stamina,
    strength: recruit.strength, defense: recruit.defense, lastDamageTime: 0,
    isDead: false, spawnX: commander.pos[0], spawnY: commander.pos[1], spawnZ: commander.pos[2],
    weaponRange: gear.range, weaponName: gear.name, equipped: gear.equipped,
  };

  npcStates.set(recruit.id, npcState);
  players.set(recruit.id, npcState);

  // Broadcast to other players (not the commander — client handles its own army spawn)
  broadcast(commanderUserId, {
    type: 'player_joined', id: recruit.id, username: recruit.name,
    pos: spawnPos, rot: 0, hp: npcState.hp, maxHp: npcState.maxHp, isNpc: true,
    equipped: gear.equipped,
    commanderId: commanderUserId,
  });

  // Rebuild chain of command for the whole army
  await rebuildChainOfCommand(commanderUserId);

  console.log(`[NPC] Live-registered ${recruit.name} (${recruit.npc_type}) for ${commanderUserId}`);
};

/** Refresh all active NPCs for a commander from DB — picks up rank changes, equipment, promotions. */
const refreshArmyState = async (commanderUserId: string): Promise<void> => {
  const recruits = await Data.playerCharacter.findRecruitsByCommander(commanderUserId);

  for (const recruit of recruits) {
    const brain = activeNPCs.get(recruit.id);
    const npc = npcStates.get(recruit.id);
    if (!brain || !npc) continue;

    // Refresh full equipment (weapons, shields, armor)
    const gear = await loadEquipment(recruit.id);
    npc.weaponRange = gear.range;
    npc.weaponName = gear.name;
    npc.equipped = gear.equipped;

    // Refresh stats from DB
    npc.strength = recruit.strength;
    npc.defense = recruit.defense;
    npc.maxHp = recruit.max_health;
    npc.maxStamina = recruit.max_stamina;
    npc.username = recruit.name;
    brain.name = recruit.name;
  }

  // Rebuild chain of command with updated ranks
  await rebuildChainOfCommand(commanderUserId);

  // Broadcast equipment update to all clients
  broadcastAll({
    type: 'army_refreshed',
    commanderId: commanderUserId,
    units: recruits
      .filter((r) => npcStates.has(r.id))
      .map((r) => ({
        id: r.id,
        equipped: npcStates.get(r.id)!.equipped,
      })),
  });

  console.log(`[NPC] Refreshed army state for ${commanderUserId} (${recruits.length} recruits)`);
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
const lastBroadcastPos = new Map<string, [number, number, number]>();
const lastBroadcastRot = new Map<string, number>();
const lastBroadcastAction = new Map<string, string>();

setInterval(() => {
  auditTickCounter++;
  const shouldLog = auditTickCounter % 20 === 0; // Log every 10 seconds (20 * 500ms)

  const LIGHT_ATTACK_COOLDOWN = 800;  // 0.8s between light swings
  const HEAVY_ATTACK_COOLDOWN = 1500; // 1.5s between heavy swings

  // Pre-compute army unit counts (avoids O(n²) in behavior tree)
  const armyUnitCounts = new Map<string, number>();
  for (const [, b] of activeNPCs) {
    armyUnitCounts.set(b.commanderUserId, (armyUnitCounts.get(b.commanderUserId) || 0) + 1);
  }
  setArmyCountCache(armyUnitCounts);

  // Collect all NPC updates for batched broadcast
  const npcUpdates: { id: string; pos: [number, number, number]; rot: number; action: string; hp: number; maxHp: number; stamina: number; mood: number; fear: number; status: string }[] = [];

  for (const [id, brain] of activeNPCs) {
    const npc = npcStates.get(id);
    if (!npc || npc.isDead) continue;

    // Attack cooldown — skip tick if still in attack animation
    const now = Date.now();
    if (npc.action === 'attack_light' && now - npc.actionStartTime < LIGHT_ATTACK_COOLDOWN) continue;
    if (npc.action === 'attack_heavy' && now - npc.actionStartTime < HEAVY_ATTACK_COOLDOWN) continue;

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
      let dx = decision.moveTarget[0] - npc.pos[0];
      let dz = decision.moveTarget[2] - npc.pos[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.3) {
        // Check for blockers ahead — steer around them
        const dirX = dx / dist;
        const dirZ = dz / dist;
        let steerX = 0;
        let steerZ = 0;
        for (const [otherId] of activeNPCs) {
          if (otherId === id) continue;
          const other = npcStates.get(otherId);
          if (!other || other.isDead) continue;
          const toDx = other.pos[0] - npc.pos[0];
          const toDz = other.pos[2] - npc.pos[2];
          const toDist = Math.sqrt(toDx * toDx + toDz * toDz);
          if (toDist > 2.0 || toDist < 0.01) continue;
          // Is this unit ahead of us? (dot product with move direction)
          const dot = (toDx / toDist) * dirX + (toDz / toDist) * dirZ;
          if (dot > 0.3) {
            // Steer perpendicular — always go right of the blocker
            const perpX = -dirZ;
            const perpZ = dirX;
            const steerStrength = (2.0 - toDist) / 2.0;
            steerX += perpX * steerStrength;
            steerZ += perpZ * steerStrength;
          }
        }
        // Also check commander as blocker
        const cmd = players.get(brain.commanderUserId);
        if (cmd) {
          const toDx = cmd.pos[0] - npc.pos[0];
          const toDz = cmd.pos[2] - npc.pos[2];
          const toDist = Math.sqrt(toDx * toDx + toDz * toDz);
          if (toDist < 2.0 && toDist > 0.01) {
            const dot = (toDx / toDist) * dirX + (toDz / toDist) * dirZ;
            if (dot > 0.3) {
              steerX += -dirZ * (2.0 - toDist) / 2.0;
              steerZ += dirX * (2.0 - toDist) / 2.0;
            }
          }
        }
        // Blend steer into move direction
        const finalDx = dirX + steerX * 0.8;
        const finalDz = dirZ + steerZ * 0.8;
        const fLen = Math.sqrt(finalDx * finalDx + finalDz * finalDz) || 1;

        const isSprinting = decision.reason.includes('sprinting');
        const maxSpeed = isSprinting ? 3.5 : decision.action === 'run' ? 2.8 : 1.5;
        const speed = Math.min(maxSpeed, dist);
        npc.pos = [
          npc.pos[0] + (finalDx / fLen) * speed,
          decision.moveTarget[1],
          npc.pos[2] + (finalDz / fLen) * speed,
        ];
        if (!decision.faceTarget) {
          npc.rot = Math.atan2(dx, dz) * 180 / Math.PI;
        }
        // NPCs trample vegetation when moving (throttled — 2% chance per tick to reduce DB load)
        if (Math.random() < 0.02) {
          const { checkTrampling } = require('../vegetation');
          checkTrampling(npc.pos[0], npc.pos[2]).catch(() => {});
        }
      }
    }

    // In formation follow mode: face same direction as anchor — but NOT when holding a commanded facing
    if ((brain.agenda === 'follow_commander' || brain.agenda === 'protect_commander') && !decision.faceTarget && !brain.moveToFacing) {
      if (brain.rank === 'centurion') {
        const commander = players.get(brain.commanderUserId);
        if (commander) npc.rot = commander.rot;
      } else {
        // Find centurion and match their rotation
        for (const [cId, cBrain] of activeNPCs) {
          if (cBrain.commanderUserId === brain.commanderUserId && cBrain.rank === 'centurion') {
            const centurionNpc = npcStates.get(cId);
            if (centurionNpc) npc.rot = centurionNpc.rot;
            break;
          }
        }
      }
    }

    // ── Unit separation: soft push when overlapping ──
    // Gentle when in formation (don't disrupt grid), stronger when free-moving
    const OVERLAP_DIST = 0.8; // Push when close enough to block each other
    const pushScale = 0.4; // Strong enough to actually move — they'll snap back to formation after
    let sepX = 0;
    let sepZ = 0;
    for (const [otherId] of activeNPCs) {
      if (otherId === id) continue;
      const otherNpc = npcStates.get(otherId);
      if (!otherNpc || otherNpc.isDead) continue;
      const sdx = npc.pos[0] - otherNpc.pos[0];
      const sdz = npc.pos[2] - otherNpc.pos[2];
      const sDist = Math.sqrt(sdx * sdx + sdz * sdz);
      if (sDist < OVERLAP_DIST && sDist > 0.01) {
        const push = (OVERLAP_DIST - sDist) / OVERLAP_DIST * pushScale;
        sepX += (sdx / sDist) * push;
        sepZ += (sdz / sDist) * push;
      }
    }
    // Also push away from commander
    const cmdState = players.get(brain.commanderUserId);
    if (cmdState) {
      const cdx = npc.pos[0] - cmdState.pos[0];
      const cdz = npc.pos[2] - cmdState.pos[2];
      const cDist = Math.sqrt(cdx * cdx + cdz * cdz);
      if (cDist < OVERLAP_DIST && cDist > 0.01) {
        const push = (OVERLAP_DIST - cDist) / OVERLAP_DIST * pushScale;
        sepX += (cdx / cDist) * push;
        sepZ += (cdz / cDist) * push;
      }
    }
    if (sepX !== 0 || sepZ !== 0) {
      npc.pos = [npc.pos[0] + sepX, npc.pos[1], npc.pos[2] + sepZ];
    }

    // ── Draw weapon when entering combat for the first time ──
    const isCombatAction = decision.action === 'attack_light' || decision.action === 'attack_heavy'
      || decision.action === 'block' || decision.action === 'dodge'
      || decision.reason.includes('COMBAT');
    if (isCombatAction && !brain.weaponDrawn) {
      brain.weaponDrawn = true;
      broadcastAll({ type: 'npc_combat_action', id, action: 'draw_weapon', target_id: decision.faceTarget });
    }
    // Sheathe weapon when no longer in combat
    if (!isCombatAction && brain.weaponDrawn) {
      brain.weaponDrawn = false;
      broadcastAll({ type: 'npc_combat_action', id, action: 'sheathe_weapon', target_id: null });
    }

    // Execute combat actions — attack animation IS the attack
    if (decision.action === 'attack_light' || decision.action === 'attack_heavy') {
      const staminaCost = decision.action === 'attack_heavy' ? 25 : 10;
      if (npc.stamina >= staminaCost) {
        npc.action = decision.action;
        npc.actionStartTime = Date.now();
        npc.stamina -= staminaCost;

        // Broadcast the swing animation — client plays it
        broadcastAll({ type: 'npc_combat_action', id, action: decision.action, target_id: decision.faceTarget });

        // Resolve damage at animation hit point
        const { resolveAttack } = require('../combat');
        const attackType = decision.action === 'attack_heavy' ? 'heavy' : 'light';
        resolveAttack(npc, attackType as 'light' | 'heavy');
      } else {
        npc.action = 'idle'; // No stamina — can't swing
      }
    } else if (decision.action === 'dodge' && npc.stamina >= 20) {
      npc.stamina -= 20;
      npc.action = 'dodge';
      npc.actionStartTime = Date.now();
    } else {
      npc.action = decision.action;
    }

    // Determine status for client display
    const isRetreating = decision.reason.includes('RETREAT');
    const isFleeing = decision.reason.includes('FLEE');
    const status = isFleeing ? 'fleeing' : isRetreating ? 'retreating' : brain.agenda === 'guard_position' ? 'holding' : brain.agenda === 'formation' ? 'formation' : brain.agenda === 'seek_combat' ? 'attacking' : brain.agenda === 'march' ? 'marching' : 'following';

    // Collect for batched broadcast — only include if something changed
    const lastPos = lastBroadcastPos.get(id);
    const posChanged = !lastPos
      || Math.abs(npc.pos[0] - lastPos[0]) > 0.05
      || Math.abs(npc.pos[2] - lastPos[2]) > 0.05
      || Math.abs(npc.rot - (lastBroadcastRot.get(id) || 0)) > 1
      || npc.action !== (lastBroadcastAction.get(id) || '');

    if (posChanged) {
      lastBroadcastPos.set(id, [npc.pos[0], npc.pos[1], npc.pos[2]]);
      lastBroadcastRot.set(id, npc.rot);
      lastBroadcastAction.set(id, npc.action);
      npcUpdates.push({
        id, pos: npc.pos, rot: npc.rot, action: npc.action,
        hp: npc.hp, maxHp: npc.maxHp, stamina: npc.stamina,
        mood: brain.mood, fear: brain.fear, status,
      });
    }
  }

  // Single batched broadcast — 1 message instead of 80
  if (npcUpdates.length > 0) {
    broadcastAll({ type: 'npc_update_batch', npcs: npcUpdates });
  }

  // Clear the cache after tick
  setArmyCountCache(new Map());
}, 500);

// ┌──────────────────────────────────────────┐
// │ Position Broadcast (every 200ms)         │
// │ Lightweight — just sends positions       │
// │ between behavior ticks for smooth motion │
// └──────────────────────────────────────────┘

setInterval(() => {
  if (activeNPCs.size === 0) return;
  const positions: { id: string; pos: [number, number, number]; rot: number; action: string }[] = [];
  for (const [id] of activeNPCs) {
    const npc = npcStates.get(id);
    if (!npc || npc.isDead) continue;
    // Only broadcast NPCs that are actually moving — idle units don't need 200ms updates
    if (npc.action === 'idle' || npc.action === 'block') continue;
    positions.push({ id, pos: npc.pos, rot: npc.rot, action: npc.action });
  }
  if (positions.length > 0) {
    broadcastAll({ type: 'npc_positions', npcs: positions });
  }
}, 200);

// ┌──────────────────────────────────────────┐
// │ Grok Brain Tick (every 1s, staggered)    │
// └──────────────────────────────────────────┘

setInterval(async () => {
  const now = Date.now();

  for (const [id, brain] of activeNPCs) {
    // Only leaders get Grok calls — soldiers just follow formation and fight
    if (brain.rank === 'soldier') continue;

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

    // Get recent ally speech this NPC could hear
    const recentSpeech = (armySpeechLog.get(brain.commanderUserId) || [])
      .filter((s) => s.name !== brain.name) // Don't include own speech
      .slice(-3) // Last 3 things said
      .map((s) => `${s.name} said: "${s.text}"`)
      .join('\n');

    const situation = [
      `My HP: ${npc.hp}/${npc.maxHp}, Stamina: ${npc.stamina}/${npc.maxStamina}`,
      `Distance to commander: ${distToCommander}m`,
      `Current action: ${npc.action}, Agenda: ${brain.agenda}`,
      nearbyAllies.length > 0 ? `Nearby allies: ${nearbyAllies.join(', ')}` : '',
      nearbyEnemies.length > 0 ? `ENEMIES NEARBY: ${nearbyEnemies.join(', ')}` : 'The area is peaceful. No enemies in sight.',
      recentSpeech ? `\nRecent conversation nearby:\n${recentSpeech}\n(You can respond to what they said, agree, joke, or add your own thought. Or stay quiet.)` : '',
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

      // If NPC has something to say, broadcast it and log for allies to hear
      if (parsed.say) {
        const emotion = brain.mood > 70 ? 'happy' : brain.mood < 30 ? 'sad' : brain.fear > 50 ? 'fearful' : 'neutral';
        broadcastAll({
          type: 'npc_say',
          id,
          text: parsed.say,
          emotion,
        });

        // Add to army speech log so nearby allies can respond
        if (!armySpeechLog.has(brain.commanderUserId)) {
          armySpeechLog.set(brain.commanderUserId, []);
        }
        const log = armySpeechLog.get(brain.commanderUserId)!;
        log.push({ name: brain.name, text: parsed.say, time: Date.now() });
        // Keep last 10 messages, expire after 60s
        const cutoff = Date.now() - 60_000;
        while (log.length > 10 || (log.length > 0 && log[0].time < cutoff)) log.shift();
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

export { registerPlayerNPCs, unregisterPlayerNPCs, registerSingleNPC, refreshArmyState, rebuildChainOfCommand, activeNPCs, npcStates, armySpeechLog };
