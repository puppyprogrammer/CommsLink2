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
  grokIntervalMs: number;
  situationLog: string[];
  agendaLocked: boolean;

  // Formation
  formationPos: [number, number, number] | null;
  formationRot: number | null;
  formationType: string | null;
  formationAction: string | null;

  // Chain of command
  leaderId: string | null; // Who this unit follows (sergeant → decurion → centurion → commander)
  rank: string; // 'soldier' | 'sergeant' | 'decurion' | 'centurion'
  squadIndex: number; // Legacy per-leader index
  armyBlockIndex: number; // Position in the unified army block (0 = front-left, fills L-R then next row)

  // March
  marchDirection: [number, number] | null;

  // Combat visual state
  weaponDrawn: boolean;
};

type BehaviorAction = 'idle' | 'walk' | 'run' | 'attack_light' | 'attack_heavy' | 'block' | 'dodge';

type BehaviorDecision = {
  action: BehaviorAction;
  moveTarget: [number, number, number] | null;
  faceTarget: string | null;
  reason: string;
};

const getCommanderPos = (brain: NPCBrain, players: Map<string, PlayerSyncState>): [number, number, number] | null => {
  const commander = players.get(brain.commanderUserId);
  return commander ? commander.pos : null;
};

/** Get the position of this unit's direct leader in the chain of command. */
const getLeaderPos = (brain: NPCBrain, players: Map<string, PlayerSyncState>): [number, number, number] | null => {
  if (brain.leaderId) {
    const leader = players.get(brain.leaderId);
    if (leader && !leader.isDead) return leader.pos;
  }
  // Fallback to commander
  return getCommanderPos(brain, players);
};

// ── Formation spacing config (per commander, adjustable via API) ──
const formationSpacingConfig = new Map<string, { spacing: number; rowDepth: number }>();

const getFormationSpacing = (commanderUserId: string): { spacing: number; rowDepth: number } =>
  formationSpacingConfig.get(commanderUserId) || { spacing: 1.0, rowDepth: 1.5 };

const setFormationSpacing = (commanderUserId: string, spacing: number, rowDepth: number): void => {
  formationSpacingConfig.set(commanderUserId, { spacing, rowDepth });
};

// ── In-memory relation cache (updated by API route on change) ──
// Key: "userId:targetId" → relation
const relationCache = new Map<string, string>();

const getRelation = (userId: string, targetId: string): string =>
  relationCache.get(`${userId}:${targetId}`) || 'neutral';

const setRelationCache = (userId: string, targetId: string, relation: string): void => {
  if (relation === 'neutral') {
    relationCache.delete(`${userId}:${targetId}`);
  } else {
    relationCache.set(`${userId}:${targetId}`, relation);
  }
};

const isEnemy = (commanderA: string, commanderB: string): boolean =>
  getRelation(commanderA, commanderB) === 'enemy' || getRelation(commanderB, commanderA) === 'enemy';

const isAlly = (commanderA: string, commanderB: string): boolean =>
  getRelation(commanderA, commanderB) === 'ally' || getRelation(commanderB, commanderA) === 'ally';

/** Find nearest enemy. Uses relation system + encounter logic.
 *  - Same commander → always ally (skip)
 *  - Encounter NPCs → enemy to everyone
 *  - Player-owned NPCs → attack targets their commander marked as enemy
 *  - Neutral/ally real players → never targeted */
const findNearestEnemy = (
  npcPos: [number, number, number],
  npcUserId: string,
  commanderUserId: string,
  players: Map<string, PlayerSyncState>,
  allBrains?: Map<string, NPCBrain>,
): { userId: string; distance: number; state: PlayerSyncState } | null => {
  let nearest: { userId: string; distance: number; state: PlayerSyncState } | null = null;

  const isEncounterNPC = commanderUserId.startsWith('encounter-');

  for (const [id, p] of players) {
    if (id === npcUserId || id === commanderUserId || p.isDead) continue;

    if (allBrains) {
      const otherBrain = allBrains.get(id);

      // Same commander → ally, skip
      if (otherBrain && otherBrain.commanderUserId === commanderUserId) continue;

      // Determine the other entity's commander (for NPCs it's their commander, for real players it's themselves)
      const otherCommander = otherBrain ? otherBrain.commanderUserId : id;

      if (isEncounterNPC) {
        // Encounter NPCs attack everyone except other encounter NPCs from the same group
        if (otherCommander.startsWith('encounter-')) continue;
      } else {
        // Player-owned NPCs: only attack if relation is enemy (either direction)
        if (!isEnemy(commanderUserId, otherCommander)) continue;
      }
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

/** Count active NPCs for a commander (for block width calculation). */
const countArmyUnits = (commanderUserId: string, allBrains: Map<string, NPCBrain>): number => {
  let count = 0;
  for (const [, b] of allBrains) {
    if (b.commanderUserId === commanderUserId) count++;
  }
  return count;
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
  const leaderPos = getLeaderPos(brain, players);
  const nearestEnemy = findNearestEnemy(npc.pos, npc.userId, brain.commanderUserId, players, allBrains);

  const distToCommander = commanderPos ? dist3d(npc.pos, commanderPos) : 999;
  const distToEnemy = nearestEnemy?.distance ?? 999;

  // ── 1. Flee (highest priority) ──
  if (brain.agenda === 'flee' || brain.fear > 80) {
    if (commanderPos) {
      return { action: 'run', moveTarget: commanderPos, faceTarget: null, reason: 'FLEE: fear/agenda' };
    }
    if (nearestEnemy) {
      const dx = npc.pos[0] - nearestEnemy.state.pos[0];
      const dz = npc.pos[2] - nearestEnemy.state.pos[2];
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      return { action: 'run', moveTarget: [npc.pos[0] + (dx / len) * 10, npc.pos[1], npc.pos[2] + (dz / len) * 10], faceTarget: null, reason: 'FLEE: away from enemy' };
    }
    return { action: 'idle', moveTarget: null, faceTarget: null, reason: 'FLEE: nowhere to go' };
  }

  // ── 2. HP retreat ──
  const hpPercent = npc.hp / npc.maxHp * 100;
  if (hpPercent < brain.retreatThreshold && brain.selfPreservation > 40) {
    if (commanderPos && distToCommander > 3) {
      return { action: 'run', moveTarget: commanderPos, faceTarget: nearestEnemy?.userId ?? null, reason: `RETREAT: HP ${hpPercent.toFixed(0)}% < threshold ${brain.retreatThreshold}` };
    }
    if (distToEnemy < 4) {
      return { action: 'block', moveTarget: null, faceTarget: nearestEnemy?.userId ?? null, reason: 'RETREAT: blocking, enemy close' };
    }
  }

  // ── Formation type modifiers ──
  // Formation = geometry (shape), NOT behavior. It modifies how combat/movement works.
  const isShieldWall = brain.formationType === 'shield_wall';
  const hasFormation = !!brain.formationType; // Any formation = don't break ranks

  // ── 3. Guard / Hold position ──
  if (brain.agenda === 'guard_position') {
    // Fight at position, never chase
    if (nearestEnemy && distToEnemy < 5) {
      if (isShieldWall) {
        if (distToEnemy < 2.5 && npc.stamina >= 10 && Math.random() < 0.2) {
          return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'GUARD+SHIELD: quick counter' };
        }
        return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'GUARD+SHIELD: wall holding' };
      }
      if (distToEnemy < 2.5 && npc.stamina >= 10 && Math.random() * 100 < brain.aggression) {
        return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'GUARD: melee counter-attack' };
      }
      return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'GUARD: blocking nearby enemy' };
    }
    if (isShieldWall) return { action: 'block', moveTarget: null, faceTarget: null, reason: 'GUARD+SHIELD: wall idle' };
    return { action: 'idle', moveTarget: null, faceTarget: null, reason: 'GUARD: holding position' };
  }

  // ── 3.5 March — move forward maintaining formation ──
  if (brain.agenda === 'march' && brain.marchDirection) {
    // In shield wall: shields up while marching, only counter-attack
    if (nearestEnemy && distToEnemy < 2.5 && npc.stamina >= 10) {
      if (isShieldWall && Math.random() < 0.2) {
        return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'MARCH+SHIELD: quick counter' };
      }
      if (!isShieldWall && Math.random() * 100 < brain.aggression) {
        return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'MARCH: engaging enemy on the move' };
      }
    }

    const marchTarget: [number, number, number] = [
      npc.pos[0] + brain.marchDirection[0] * 20,
      npc.pos[1],
      npc.pos[2] + brain.marchDirection[1] * 20,
    ];
    return { action: 'walk', moveTarget: marchTarget, faceTarget: nearestEnemy?.userId ?? null, reason: isShieldWall ? 'MARCH+SHIELD: advancing with shields' : 'MARCH: advancing forward' };
  }

  // ── 4. Commander protection ──
  if (brain.commanderProtection > 60 && commanderPos && nearestEnemy && !hasFormation) {
    const enemyToCommander = dist3d(nearestEnemy.state.pos, commanderPos);
    if (enemyToCommander < 5 && distToCommander > 3) {
      return { action: 'run', moveTarget: commanderPos, faceTarget: nearestEnemy.userId, reason: 'PROTECT: enemy near commander' };
    }
  }

  // ── 4.5. Seek combat — chase enemies ──
  if (nearestEnemy && brain.agenda === 'seek_combat') {
    // In formation: don't break ranks to chase far enemies, fight at position
    if (hasFormation) {
      if (distToEnemy < 3) {
        if (isShieldWall) {
          if (distToEnemy < 2.5 && npc.stamina >= 10 && Math.random() < 0.25) {
            return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'SEEK+SHIELD: counter' };
          }
          return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'SEEK+SHIELD: wall holding' };
        }
        if (distToEnemy < 2.5 && npc.stamina >= 10 && Math.random() * 100 < brain.aggression) {
          return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'SEEK+FORMATION: melee attack' };
        }
        return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'SEEK+FORMATION: blocking' };
      }
      // Don't chase — fall through to follow/formation positioning
    } else {
      // No formation: chase if outside melee range (melee handled in section 5)
      if (distToEnemy >= 3 && distToEnemy < 50) {
        return { action: 'run', moveTarget: nearestEnemy.state.pos as [number, number, number], faceTarget: nearestEnemy.userId, reason: `SEEK: running toward enemy (${distToEnemy.toFixed(1)}m)` };
      }
    }
  }

  // ── 5. Combat — engage enemies within range (respects formation) ──
  if (nearestEnemy && distToEnemy < 15 && brain.agenda !== 'rest' && brain.agenda !== 'socialize') {
    const inAttackRange = distToEnemy < (npc.weaponRange || 1.0);
    const inCloseRange = distToEnemy < 8;

    // In melee range — fight at position
    if (inAttackRange) {
      // Shield wall: mostly block, occasional counter
      if (isShieldWall) {
        if (npc.stamina >= 10 && Math.random() < 0.2) {
          return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'COMBAT+SHIELD: counter-strike' };
        }
        return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'COMBAT+SHIELD: wall holding' };
      }

      // Counter-attack after being hit or blocking
      if (npc.action === 'hit' || npc.action === 'block') {
        if (Math.random() * 100 < brain.counterAttack && npc.stamina >= 10) {
          return { action: 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'COMBAT: counter-attack after hit/block' };
        }
      }

      const roll = Math.random() * 100;
      if (nearestEnemy.state.action.startsWith('attack') && npc.stamina >= 20 && roll < 20) {
        return { action: 'dodge', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'COMBAT: dodge incoming attack' };
      }
      if (roll < brain.defense && brain.aggression < 70) {
        return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: `COMBAT: block (def=${brain.defense}, roll=${roll.toFixed(0)})` };
      }
      if (roll < brain.aggression && npc.stamina >= 10) {
        const heavy = npc.stamina >= 25 && Math.random() < 0.3;
        return { action: heavy ? 'attack_heavy' : 'attack_light', moveTarget: null, faceTarget: nearestEnemy.userId, reason: `COMBAT: attack (agg=${brain.aggression}, roll=${roll.toFixed(0)})` };
      }
      // In formation: hold position and block, don't flank
      if (hasFormation) {
        return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'COMBAT+FORMATION: holding position' };
      }
      if (brain.flankTendency > 30) {
        const dir = brain.flankDirection > 50 ? 1 : -1;
        const angle = Math.atan2(npc.pos[0] - nearestEnemy.state.pos[0], npc.pos[2] - nearestEnemy.state.pos[2]);
        const circleAngle = angle + (dir * 0.5);
        const tx = nearestEnemy.state.pos[0] + Math.sin(circleAngle) * 2;
        const tz = nearestEnemy.state.pos[2] + Math.cos(circleAngle) * 2;
        return { action: 'walk', moveTarget: [tx, npc.pos[1], tz], faceTarget: nearestEnemy.userId, reason: 'COMBAT: flanking' };
      }
      return { action: 'block', moveTarget: null, faceTarget: nearestEnemy.userId, reason: 'COMBAT: default block in range' };
    }

    // Close to enemy — close the gap ONLY if not in formation
    if (inCloseRange && !hasFormation) {
      return { action: 'run', moveTarget: nearestEnemy.state.pos as [number, number, number], faceTarget: nearestEnemy.userId, reason: `COMBAT: closing to melee (${distToEnemy.toFixed(1)}m)` };
    }

    // Far enemy — only chase if aggressive AND no formation
    if (!hasFormation && brain.aggression > 30 && (brain.agenda === 'seek_combat' || brain.agenda === 'protect_commander')) {
      return { action: 'run', moveTarget: nearestEnemy.state.pos as [number, number, number], faceTarget: nearestEnemy.userId, reason: `COMBAT: chasing enemy (${distToEnemy.toFixed(1)}m)` };
    }
  }

  // ── 6. Follow commander in unified army block ──
  // ALL units form one tight block behind the commander.
  // Centurion = front-left (index 0), then decurions, sergeants, soldiers fill L→R, row by row.
  // Block faces the same direction as the commander.
  if (brain.agenda === 'follow_commander' || brain.agenda === 'protect_commander') {
    if (commanderPos) {
      const config = getFormationSpacing(brain.commanderUserId);
      const SPACING = config.spacing;   // shoulder-to-shoulder distance
      const ROW_DEPTH = config.rowDepth; // front-to-back row distance

      // Roman maniple formation: always 2 rows deep, as wide as needed
      // Front row fills first (L→R), back row gets the remainder
      const totalUnits = allBrains ? countArmyUnits(brain.commanderUserId, allBrains) : 5;
      const COLS = Math.ceil(totalUnits / 2);

      const idx = brain.armyBlockIndex;
      const row = Math.floor(idx / COLS);
      const col = idx % COLS;
      const colOffset = (col - (COLS - 1) / 2) * SPACING;

      // Commander's facing direction
      const commander = players.get(brain.commanderUserId);
      const cmdRot = commander ? commander.rot : 0;
      const rad = cmdRot * Math.PI / 180;
      const fwdX = Math.sin(rad);
      const fwdZ = Math.cos(rad);
      const rightX = Math.cos(rad);
      const rightZ = -Math.sin(rad);

      // Position: behind commander (row 0 = 3m back, each row further back) + column offset
      const behindDist = 3 + row * ROW_DEPTH;
      const targetPos: [number, number, number] = [
        commanderPos[0] - fwdX * behindDist + rightX * colOffset,
        commanderPos[1],
        commanderPos[2] - fwdZ * behindDist + rightZ * colOffset,
      ];

      const distToTarget = dist3d(npc.pos, targetPos);
      const distToCmd = dist3d(npc.pos, commanderPos);

      // Sprint if very far behind
      if (distToCmd > 20) {
        return { action: 'run', moveTarget: targetPos, faceTarget: null, reason: `FOLLOW: sprinting to formation (${distToCmd.toFixed(1)}m from cmd)` };
      }
      if (distToTarget > 3) {
        return { action: 'run', moveTarget: targetPos, faceTarget: null, reason: `FOLLOW: running to position (${distToTarget.toFixed(1)}m off)` };
      }
      if (distToTarget > 0.3) {
        return { action: 'walk', moveTarget: targetPos, faceTarget: null, reason: `FOLLOW: adjusting position (${distToTarget.toFixed(1)}m off)` };
      }
      // In position — idle
      return { action: 'idle', moveTarget: null, faceTarget: null, reason: `FOLLOW: in formation (${distToTarget.toFixed(1)}m off)` };
    }
  }

  // ── 7. Default idle ──
  return { action: 'idle', moveTarget: null, faceTarget: null, reason: `IDLE: agenda=${brain.agenda}, distCmd=${distToCommander.toFixed(1)}, distEnemy=${distToEnemy.toFixed(1)}` };
};

export type { NPCBrain, BehaviorDecision, BehaviorAction };
export { evaluateBehavior, getCommanderPos, findNearestEnemy, relationCache, setRelationCache, getRelation, isEnemy, isAlly, getFormationSpacing, setFormationSpacing };
