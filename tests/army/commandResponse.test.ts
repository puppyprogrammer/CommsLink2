import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { evaluateBehavior } from '../../services/api/src/handlers/gameSync/ai/behaviorTree';
import type { NPCBrain, BehaviorDecision } from '../../services/api/src/handlers/gameSync/ai/behaviorTree';
import type { PlayerSyncState } from '../../services/api/src/handlers/gameSync/combat';
import { WebSocket } from 'ws';

// ── Test Helpers ──

const makePlayer = (id: string, pos: [number, number, number] = [0, 0, 0]): PlayerSyncState => ({
  userId: id,
  characterId: id,
  username: `player_${id}`,
  ws: null as unknown as WebSocket,
  pos,
  rot: 0,
  action: 'idle',
  actionStartTime: 0,
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  strength: 10,
  defense: 10,
  lastDamageTime: 0,
  isDead: false,
  spawnX: 0,
  spawnY: 0,
  spawnZ: 0,
});

const makeBrain = (overrides: Partial<NPCBrain> = {}): NPCBrain => ({
  characterId: 'npc-1',
  commanderUserId: 'commander-1',
  name: 'Test Soldier',
  humor: 50, obedience: 50, bravery: 50, curiosity: 50, greed: 50, aggressionNature: 50, verbosity: 50,
  mood: 50, fear: 0, loyalty: 50, familiarity: 50, attraction: 0, warmth: 50, respect: 50,
  fatigue: 0, hunger: 0, procreationDrive: 20,
  aggression: 50, defense: 50, counterAttack: 50, flankTendency: 30, flankDirection: 50,
  retreatThreshold: 25, pursuit: 50, groupCohesion: 50, commanderProtection: 50, selfPreservation: 50,
  agenda: 'follow_commander',
  targetId: null,
  lastGrokCall: 0,
  grokIntervalMs: 30000,
  situationLog: [],
  agendaLocked: false,
  ...overrides,
});

const setupWorld = () => {
  const players = new Map<string, PlayerSyncState>();
  const brains = new Map<string, NPCBrain>();
  return { players, brains };
};

// ── Tests ──

describe('Army Command Response', () => {

  describe('Guard Position (hold/stay)', () => {
    it('NPC with guard_position agenda should idle when no enemies nearby', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [0, 0, 0]);
      const npc = makePlayer('npc-1', [3, 0, 3]);
      const brain = makeBrain({ agenda: 'guard_position' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('idle');
      expect(decision.moveTarget).toBeNull();
      expect(decision.reason).toContain('GUARD');
    });

    it('NPC with guard_position should NOT follow commander even if far away', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [50, 0, 50]); // 70m away
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const brain = makeBrain({ agenda: 'guard_position' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('idle');
      expect(decision.reason).toContain('GUARD');
      // Should NOT contain 'FOLLOW'
      expect(decision.reason).not.toContain('FOLLOW');
    });

    it('NPC with guard_position should block if enemy enters melee range', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 20]);
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const enemy = makePlayer('enemy-1', [3, 0, 0]); // 3m away — within 5m threshold
      const brain = makeBrain({ agenda: 'guard_position' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      players.set('enemy-1', enemy);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(['block', 'attack_light']).toContain(decision.action);
      expect(decision.reason).toContain('GUARD');
    });

    it('NPC with guard_position should NOT chase enemy beyond 5m', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 20]);
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const enemy = makePlayer('enemy-1', [8, 0, 0]); // 8m away — beyond guard range
      const brain = makeBrain({ agenda: 'guard_position' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      players.set('enemy-1', enemy);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('idle');
      expect(decision.reason).toContain('GUARD');
    });
  });

  describe('Follow Commander', () => {
    it('NPC should run to commander when far (>12m)', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 0]); // 20m away
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const brain = makeBrain({ agenda: 'follow_commander' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('run');
      expect(decision.reason).toContain('FOLLOW');
      expect(decision.reason).toContain('running');
    });

    it('NPC should walk to commander at medium distance (5-12m)', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [8, 0, 0]); // 8m away
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const brain = makeBrain({ agenda: 'follow_commander' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('walk');
      expect(decision.reason).toContain('FOLLOW');
      expect(decision.reason).toContain('walking');
    });

    it('NPC should idle when close to commander (<5m)', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [3, 0, 0]); // 3m away
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const brain = makeBrain({ agenda: 'follow_commander' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('idle');
    });
  });

  describe('Flee Behavior', () => {
    it('NPC with flee agenda should run toward commander', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 0]);
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const brain = makeBrain({ agenda: 'flee' });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('run');
      expect(decision.reason).toContain('FLEE');
    });

    it('NPC with high fear (>80) should flee even if agenda is follow', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 0]);
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const brain = makeBrain({ agenda: 'follow_commander', fear: 90 });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('run');
      expect(decision.reason).toContain('FLEE');
    });
  });

  describe('Combat Behavior', () => {
    it('NPC with seek_combat agenda should approach enemy', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 20]);
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const enemy = makePlayer('enemy-1', [6, 0, 0]); // 6m — approach range
      const brain = makeBrain({ agenda: 'seek_combat', aggression: 80 });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      players.set('enemy-1', enemy);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('run');
      expect(decision.reason).toContain('COMBAT');
      expect(decision.reason).toContain('approaching');
    });

    it('NPC with follow_commander agenda should NOT approach distant enemy', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [3, 0, 0]); // close
      const npc = makePlayer('npc-1', [0, 0, 0]);
      const enemy = makePlayer('enemy-1', [7, 0, 0]); // 7m — approach range but agenda is follow
      const brain = makeBrain({ agenda: 'follow_commander', aggression: 80 });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      players.set('enemy-1', enemy);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      // Should idle near commander, NOT approach enemy
      expect(decision.action).toBe('idle');
      expect(decision.reason).not.toContain('approaching');
    });
  });

  describe('Ally Detection', () => {
    it('NPCs with same commander should NOT treat each other as enemies', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 20]);
      const npc1 = makePlayer('npc-1', [0, 0, 0]);
      const npc2 = makePlayer('npc-2', [2, 0, 0]); // 2m away — melee range

      const brain1 = makeBrain({ characterId: 'npc-1', agenda: 'seek_combat', aggression: 100 });
      const brain2 = makeBrain({ characterId: 'npc-2', commanderUserId: 'commander-1' });

      players.set('commander-1', commander);
      players.set('npc-1', npc1);
      players.set('npc-2', npc2);
      brains.set('npc-1', brain1);
      brains.set('npc-2', brain2);

      const decision = evaluateBehavior(brain1, npc1, players, brains);

      // Should NOT attack ally even with 100 aggression
      expect(decision.action).not.toBe('attack_light');
      expect(decision.action).not.toBe('attack_heavy');
    });

    it('NPCs with different commanders SHOULD treat each other as enemies', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [20, 0, 20]);
      const npc1 = makePlayer('npc-1', [0, 0, 0]);
      const enemy_npc = makePlayer('enemy-npc', [2, 0, 0]); // 2m — melee

      const brain1 = makeBrain({ characterId: 'npc-1', agenda: 'seek_combat', aggression: 100 });
      const brain_enemy = makeBrain({ characterId: 'enemy-npc', commanderUserId: 'other-commander' });

      players.set('commander-1', commander);
      players.set('npc-1', npc1);
      players.set('enemy-npc', enemy_npc);
      brains.set('npc-1', brain1);
      brains.set('enemy-npc', brain_enemy);

      // Run multiple times since combat has random rolls
      let attacked = false;
      for (let i = 0; i < 20; i++) {
        const decision = evaluateBehavior(brain1, npc1, players, brains);
        if (decision.action === 'attack_light' || decision.action === 'attack_heavy') {
          attacked = true;
          break;
        }
      }

      expect(attacked).toBe(true);
    });
  });

  describe('HP Retreat', () => {
    it('Low HP NPC should retreat to commander', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [15, 0, 0]);
      const npc = makePlayer('npc-1', [0, 0, 0]);
      npc.hp = 10; // 10% HP
      npc.maxHp = 100;
      const brain = makeBrain({ agenda: 'seek_combat', retreatThreshold: 25, selfPreservation: 60 });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('run');
      expect(decision.reason).toContain('RETREAT');
    });
  });

  describe('Commander Protection', () => {
    it('NPC with high commander_protection should rush to protect when enemy near commander', () => {
      const { players, brains } = setupWorld();
      const commander = makePlayer('commander-1', [10, 0, 0]);
      const npc = makePlayer('npc-1', [0, 0, 0]); // 10m from commander
      const enemy = makePlayer('enemy-1', [12, 0, 0]); // 2m from commander

      const brain = makeBrain({ agenda: 'follow_commander', commanderProtection: 80 });

      players.set('commander-1', commander);
      players.set('npc-1', npc);
      players.set('enemy-1', enemy);
      brains.set('npc-1', brain);

      const decision = evaluateBehavior(brain, npc, players, brains);

      expect(decision.action).toBe('run');
      expect(decision.reason).toContain('PROTECT');
    });
  });
});
