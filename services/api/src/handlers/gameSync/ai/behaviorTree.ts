// ┌──────────────────────────────────────────┐
// │ Tier 2: Behavior Tree (500ms tick)       │
// │ Pure code — no API calls, no DB calls    │
// └──────────────────────────────────────────┘

import type { PlayerSyncState } from '../combat';

/** NPC personality and behavior state, loaded from DB on spawn. */
type NPCBrain = {
  characterId: string;
  commanderUserId: string;
  name: string;

  // Personality traits (static, 0-100)
  humor: number;
  obedience: number;
  bravery: number;
  curiosity: number;
  greed: number;
  aggressionNature: number;
  verbosity: number;

  // Disposition (changes via Grok, 0-100)
  mood: number;
  fear: number;
  loyalty: number;
  familiarity: number;
  attraction: number;
  warmth: number;
  respect: number;

  // Needs (tick up, 0-100)
  fatigue: number;
  hunger: number;
  procreationDrive: number;

  // Combat behavior weights (set by Grok, 0-100)
  aggression: number;
  defense: number;
  counterAttack: number;
  flankTendency: number;
  flankDirection: number;
  retreatThreshold: number;
  pursuit: number;
  groupCohesion: number;
  commanderProtection: number;
  selfPreservation: number;

  // Current state
  agenda: string;
  targetId: string | null;
  lastGrokCall: number;
  grokIntervalMs: number; // How often this NPC thinks (tier-based)
  situationLog: string[];  // Recent events for Grok context
};

type BehaviorAction = 'idle' | 'walk' | 'run' | 'attack_light' | 'attack_heavy' | 'block' | 'dodge';

type BehaviorDecision = {
  action: BehaviorAction;
  moveTarget: [number, number, number] | null;
  faceTarget: string | null;
};

/** Find the commander's position in the player list. */
const getCommanderPos = (brain: NPCBrain, players: Map<string, PlayerSyncState>): [number, number, number] | null => {
  const commander = players.get(brain.commanderUserId);
  return commander ? commander.pos : null;
};

/** Find nearest enemy. Excludes: self, commander, and any NPC with the same commander. */
const findNearestEnemy = (
  npcPos: [number, number, number],
  npcUserId: string,
  commanderUserId: string,
  players: Map<string, PlayerSyncState>,
  allBrains?: Map<string, NPCBrain>,
): { userId: string; distance: number; state: PlayerSyncState } | null => {
  let nearest: { userId: string; distance: number; state: PlayerSyncState } | null = null;

  for (const [id, p] of players) {
    if (id === npcUserId || id === commanderUserId || p.isDead) continue;

    // Check if this entity is a friendly NPC (same commander)
    if (allBrains) {
      const otherBrain = allBrains.get(id);
      if (otherBrain && otherBrain.commanderUserId === commanderUserId) continue;
    }

    const dx = npcPos[0] - p.pos[0];
    const dz = npcPos[2] - p.pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (!nearest || dist < nearest.distance) {
      nearest = { userId: id, distance: dist, state: p };
    }
  }

  return nearest;
};

const dist3d = (a: [number, number, number], b: [number, number, number]): number => {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
};

/**
 * Evaluate the behavior tree and return a decision.
 * Runs every 500ms per NPC. Pure math — no async, no DB, no API.
 */
const evaluateBehavior = (
  brain: NPCBrain,
  npc: PlayerSyncState,
  players: Map<string, PlayerSyncState>,
  allBrains?: Map<string, NPCBrain>,
): BehaviorDecision => {
  const commanderPos = getCommanderPos(brain, players);
  const nearestEnemy = findNearestEnemy(npc.pos, npc.userId, brain.commanderUserId, players, allBrains);

  const distToCommander = commanderPos ? dist3d(npc.pos, commanderPos) : 999;
  const distToEnemy = nearestEnemy?.distance ?? 999;

  // ── Agenda: flee ──
  if (brain.agenda === 'flee' || brain.fear > 80) {
    if (commanderPos) {
      return { action: 'run', moveTarget: commanderPos, faceTarget: null };
    }
    // Flee away from enemy
    if (nearestEnemy) {
      const dx = npc.pos[0] - nearestEnemy.state.pos[0];
      const dz = npc.pos[2] - nearestEnemy.state.pos[2];
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      return { action: 'run', moveTarget: [npc.pos[0] + (dx / len) * 10, npc.pos[1], npc.pos[2] + (dz / len) * 10], faceTarget: null };
    }
    return { action: 'idle', moveTarget: null, faceTarget: null };
  }

  // ── HP check: retreat if low ──
  const hpPercent = npc.hp / npc.maxHp * 100;
  if (hpPercent < brain.retreatThreshold && brain.selfPreservation > 40) {
    if (commanderPos && distToCommander > 3) {
      return { action: 'run', moveTarget: commanderPos, faceTarget: nearestEnemy?.userId ?? null };
    }
    // Block if enemy close and retreating
    if (distToEnemy < 4) {
      return { action: 'block', moveTarget: null, faceTarget: nearestEnemy?.userId ?? null };
    }
  }

  // ── Commander protection ──
  if (brain.commanderProtection > 60 && commanderPos && nearestEnemy) {
    // Is an enemy close to the commander?
    const enemyToCommander = dist3d(nearestEnemy.state.pos, commanderPos);
    if (enemyToCommander < 5 && distToCommander > 3) {
      // Rush to protect
      return { action: 'run', moveTarget: commanderPos, faceTarget: nearestEnemy.userId };
    }
  }

  // ── Combat: enemy in range ──
  if (nearestEnemy && distToEnemy < 15) {
    const inAttackRange = distToEnemy < 2.5;
    const inApproachRange = distToEnemy < 8;

    // If enemy just attacked us (we're in hit state), consider counter-attack
    if (npc.action === 'hit' || npc.action === 'block') {
      if (Math.random() * 100 < brain.counterAttack && inAttackRange && npc.stamina >= 10) {
        return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId };
      }
    }

    // In attack range: decide attack vs block vs dodge
    if (inAttackRange) {
      const roll = Math.random() * 100;

      // Dodge if enemy is attacking and we're brave/agile enough
      if (nearestEnemy.state.action.startsWith('attack') && npc.stamina >= 20 && roll < 20) {
        return { action: 'dodge', moveTarget: null, faceTarget: nearestEnemy.userId };
      }

      // Block if defensive
      if (roll < brain.defense && brain.aggression < 70) {
        return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId };
      }

      // Attack if aggressive enough
      if (roll < brain.aggression && npc.stamina >= 10) {
        const heavy = npc.stamina >= 25 && Math.random() < 0.3;
        return { action: heavy ? 'attack_heavy' : 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId };
      }

      // Flank: circle around enemy
      if (brain.flankTendency > 30) {
        const dir = brain.flankDirection > 50 ? 1 : -1;
        const angle = Math.atan2(npc.pos[0] - nearestEnemy.state.pos[0], npc.pos[2] - nearestEnemy.state.pos[2]);
        const circleAngle = angle + (dir * 0.5);
        const tx = nearestEnemy.state.pos[0] + Math.sin(circleAngle) * 2;
        const tz = nearestEnemy.state.pos[2] + Math.cos(circleAngle) * 2;
        return { action: 'walk', moveTarget: [tx, npc.pos[1], tz], faceTarget: nearestEnemy.userId };
      }

      // Default: block
      return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId };
    }

    // Approaching: move toward enemy
    if (inApproachRange && brain.aggression > 30) {
      return { action: 'run', moveTarget: nearestEnemy.state.pos as [number, number, number], faceTarget: nearestEnemy.userId };
    }
  }

  // ── Follow commander ──
  if (brain.agenda === 'follow_commander' || brain.agenda === 'protect_commander') {
    if (commanderPos) {
      if (distToCommander > 10) {
        return { action: 'run', moveTarget: commanderPos, faceTarget: null };
      }
      if (distToCommander > 4) {
        return { action: 'walk', moveTarget: commanderPos, faceTarget: null };
      }
    }
  }

  // ── Hold position ──
  if (brain.agenda === 'guard_position') {
    if (nearestEnemy && nearestEnemy.distance < 5) {
      return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId };
    }
    return { action: 'idle', moveTarget: null, faceTarget: null };
  }

  // ── Default: idle near commander ──
  return { action: 'idle', moveTarget: null, faceTarget: null };
};

export type { NPCBrain, BehaviorDecision };
export { evaluateBehavior, getCommanderPos, findNearestEnemy };
