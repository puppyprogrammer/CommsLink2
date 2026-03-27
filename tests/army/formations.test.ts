import { describe, it, expect } from 'vitest';
import { calculateFormationPositions } from '../../services/api/src/handlers/gameSync/ai/formations';
import { evaluateBehavior, setRelationCache } from '../../services/api/src/handlers/gameSync/ai/behaviorTree';
import type { NPCBrain } from '../../services/api/src/handlers/gameSync/ai/behaviorTree';
import type { PlayerSyncState } from '../../services/api/src/handlers/gameSync/combat';
import { WebSocket } from 'ws';

const makePlayer = (id: string, pos: [number, number, number] = [0, 0, 0]): PlayerSyncState => ({
  userId: id, characterId: id, username: `player_${id}`,
  ws: null as unknown as WebSocket,
  pos, rot: 0, action: 'idle', actionStartTime: 0,
  hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
  strength: 10, defense: 10, lastDamageTime: 0, isDead: false,
  spawnX: 0, spawnY: 0, spawnZ: 0, weaponRange: 2.5, weaponName: 'Iron Broadsword', equipped: [],
});

const makeBrain = (overrides: Partial<NPCBrain> = {}): NPCBrain => ({
  characterId: 'npc-1', commanderUserId: 'cmd-1', name: 'Test Soldier',
  humor: 50, obedience: 50, bravery: 50, curiosity: 50, greed: 50, aggressionNature: 50, verbosity: 50,
  mood: 50, fear: 0, loyalty: 50, familiarity: 50, attraction: 0, warmth: 50, respect: 50,
  fatigue: 0, hunger: 0, procreationDrive: 20,
  aggression: 50, defense: 50, counterAttack: 50, flankTendency: 30, flankDirection: 50,
  retreatThreshold: 25, pursuit: 50, groupCohesion: 50, commanderProtection: 50, selfPreservation: 50,
  agenda: 'follow_commander', targetId: null, lastGrokCall: 0, grokIntervalMs: 30000, situationLog: [],
  agendaLocked: false, formationPos: null, formationRot: null, formationType: null, formationAction: null, marchDirection: null, moveToTarget: null, moveToFacing: null, holdPosition: null, holdFacing: null, leaderId: null, rank: 'soldier', squadIndex: 0, armyBlockIndex: 0, weaponDrawn: false,
  ...overrides,
});

const setEnemies = (cmdA: string, cmdB: string) => {
  setRelationCache(cmdA, cmdB, 'enemy');
  setRelationCache(cmdB, cmdA, 'enemy');
};

describe('Formation Calculator', () => {

  it('Line formation: correct number of positions', () => {
    const positions = calculateFormationPositions({
      type: 'line', center: [0, 0, 0], facing: 0, width: 20,
    }, 10);
    expect(positions).toHaveLength(10);
  });

  it('Line formation: positions spread perpendicular to facing', () => {
    const positions = calculateFormationPositions({
      type: 'line', center: [0, 0, 0], facing: 0, width: 20,
    }, 5);
    // Facing 0 = north, so line should spread along X axis
    const xs = positions.map((p) => p.pos[0]);
    const zs = positions.map((p) => p.pos[2]);
    // X should vary, Z should be roughly same
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(4);
    const zRange = Math.max(...zs) - Math.min(...zs);
    expect(zRange).toBeLessThan(1); // All in same row
  });

  it('Column formation: positions spread along facing direction', () => {
    const positions = calculateFormationPositions({
      type: 'column', center: [0, 0, 0], facing: 0, depth: 20,
    }, 5);
    const zs = positions.map((p) => p.pos[2]);
    // Z should vary (column goes backward from facing)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(4);
  });

  it('Circle formation: positions form a ring', () => {
    const positions = calculateFormationPositions({
      type: 'circle', center: [10, 0, 10], radius: 5,
    }, 8);
    expect(positions).toHaveLength(8);
    // All positions should be ~5m from center
    for (const p of positions) {
      const dist = Math.sqrt((p.pos[0] - 10) ** 2 + (p.pos[2] - 10) ** 2);
      expect(dist).toBeCloseTo(5, 0);
    }
  });

  it('Shield wall: uses tighter spacing multiplier than line', () => {
    // Same unit count, default params — shield wall should be narrower
    const line = calculateFormationPositions({
      type: 'line', center: [0, 0, 0], facing: 0,
    }, 10);
    const wall = calculateFormationPositions({
      type: 'shield_wall', center: [0, 0, 0], facing: 0,
    }, 10);
    const lineWidth = Math.max(...line.map((p) => p.pos[0])) - Math.min(...line.map((p) => p.pos[0]));
    const wallWidth = Math.max(...wall.map((p) => p.pos[0])) - Math.min(...wall.map((p) => p.pos[0]));
    expect(wallWidth).toBeLessThan(lineWidth);
  });

  it('Wedge: first unit at front, wider as rows go back', () => {
    const positions = calculateFormationPositions({
      type: 'wedge', center: [0, 0, 0], facing: 0,
    }, 6);
    expect(positions).toHaveLength(6);
    // First unit should be closest to center (the tip)
    const firstDist = Math.sqrt(positions[0].pos[0] ** 2 + positions[0].pos[2] ** 2);
    const lastDist = Math.sqrt(positions[5].pos[0] ** 2 + positions[5].pos[2] ** 2);
    expect(firstDist).toBeLessThan(lastDist);
  });

  it('Square: positions form a grid', () => {
    const positions = calculateFormationPositions({
      type: 'square', center: [0, 0, 0], facing: 0, size: 10,
    }, 9);
    expect(positions).toHaveLength(9); // 3x3 grid
  });

  it('All units face the correct direction', () => {
    const facing = 45;
    const positions = calculateFormationPositions({
      type: 'line', center: [0, 0, 0], facing, width: 20,
    }, 5);
    for (const p of positions) {
      expect(p.rot).toBe(facing);
    }
  });
});

describe('Formation Behavior Tree', () => {

  it('NPC in line formation follows commander to block position', () => {
    const players = new Map<string, PlayerSyncState>();
    const brains = new Map<string, NPCBrain>();
    const commander = makePlayer('cmd-1', [50, 0, 50]);
    const npc = makePlayer('npc-1', [0, 0, 0]); // Far from commander
    const brain = makeBrain({
      agenda: 'follow_commander',
      formationType: 'line',
      armyBlockIndex: 0,
    });

    players.set('cmd-1', commander);
    players.set('npc-1', npc);
    brains.set('npc-1', brain);

    const decision = evaluateBehavior(brain, npc, players, brains);
    expect(decision.action).toBe('run');
    expect(decision.reason).toContain('FOLLOW');
  });

  it('NPC in formation idles when at block position', () => {
    const players = new Map<string, PlayerSyncState>();
    const brains = new Map<string, NPCBrain>();
    // Commander at [50,0,50] facing north (rot=0). 1 unit in army, COLS=1.
    // Index 0: row=0, col=0, position = [50, 0, 50-3] = [50, 0, 47]
    const commander = makePlayer('cmd-1', [50, 0, 50]);
    const npc = makePlayer('npc-1', [50, 0, 47]); // At formation position
    const brain = makeBrain({
      agenda: 'follow_commander',
      formationType: 'line',
      armyBlockIndex: 0,
    });

    players.set('cmd-1', commander);
    players.set('npc-1', npc);
    brains.set('npc-1', brain);

    const decision = evaluateBehavior(brain, npc, players, brains);
    expect(decision.action).toBe('idle');
    expect(decision.reason).toContain('FOLLOW');
  });

  it('Shield wall + guard: units block with shields up', () => {
    const players = new Map<string, PlayerSyncState>();
    const brains = new Map<string, NPCBrain>();
    const commander = makePlayer('cmd-1', [50, 0, 50]);
    const npc = makePlayer('npc-1', [50, 0, 48]); // Near guard position
    const brain = makeBrain({
      agenda: 'guard_position',
      formationType: 'shield_wall',
    });

    players.set('cmd-1', commander);
    players.set('npc-1', npc);
    brains.set('npc-1', brain);

    const decision = evaluateBehavior(brain, npc, players, brains);
    expect(decision.action).toBe('block');
    expect(decision.reason).toContain('SHIELD');
  });

  it('Formation NPC fights back if enemy in melee range but stays in position', () => {
    const players = new Map<string, PlayerSyncState>();
    const brains = new Map<string, NPCBrain>();
    const commander = makePlayer('cmd-1', [50, 0, 50]);
    const npc = makePlayer('npc-1', [20, 0, 20]);
    const enemy = makePlayer('enemy', [22, 0, 20]); // 2m away
    brains.set('enemy', makeBrain({ characterId: 'enemy', commanderUserId: 'enemy-cmd' }));
    setEnemies('cmd-1', 'enemy-cmd');
    const brain = makeBrain({
      agenda: 'seek_combat',
      formationType: 'line',
      aggression: 80,
    });

    players.set('cmd-1', commander);
    players.set('npc-1', npc);
    players.set('enemy', enemy);
    brains.set('npc-1', brain);

    // Run multiple times since combat is probabilistic
    let fought = false;
    for (let i = 0; i < 20; i++) {
      const decision = evaluateBehavior(brain, npc, players, brains);
      if (decision.action === 'attack_light' || decision.action === 'block') {
        fought = true;
        expect(decision.moveTarget).toBeNull(); // Stays in position
        break;
      }
    }
    expect(fought).toBe(true);
  });

  it('Formation NPC does NOT chase enemy that retreats', () => {
    const players = new Map<string, PlayerSyncState>();
    const brains = new Map<string, NPCBrain>();
    // Commander at [50,0,50]. NPC at block position [50,0,47]. Enemy 10m away.
    const commander = makePlayer('cmd-1', [50, 0, 50]);
    const npc = makePlayer('npc-1', [50, 0, 47]);
    const enemy = makePlayer('enemy', [60, 0, 47]); // 10m away — outside melee
    brains.set('enemy', makeBrain({ characterId: 'enemy', commanderUserId: 'enemy-cmd' }));
    setEnemies('cmd-1', 'enemy-cmd');
    const brain = makeBrain({
      agenda: 'follow_commander',
      formationType: 'line',
      aggression: 100,
      armyBlockIndex: 0,
    });

    players.set('cmd-1', commander);
    players.set('npc-1', npc);
    players.set('enemy', enemy);
    brains.set('npc-1', brain);

    const decision = evaluateBehavior(brain, npc, players, brains);
    // Should stay in formation, not chase — formation prevents breaking ranks
    expect(decision.action).toBe('idle');
    expect(decision.reason).toContain('FOLLOW');
  });
});
