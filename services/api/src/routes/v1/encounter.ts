import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';
import Data from '../../../../../core/data';
import spawnAIArmyAction from '../../../../../core/actions/army/spawnAIArmyAction';
import { players, broadcastAll } from '../../handlers/gameSync/combat';
import { activeNPCs, npcStates, registerPlayerNPCs } from '../../handlers/gameSync/ai/npcEngine';
import { calculateFormationPositions } from '../../handlers/gameSync/ai/formations';
import type { PlayerSyncState } from '../../handlers/gameSync/combat';
import type { NPCBrain } from '../../handlers/gameSync/ai/behaviorTree';
import { WebSocket } from 'ws';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

// ── Name generators ──
const ENEMY_FIRST = ['Grimjaw', 'Bloodfang', 'Ironmaw', 'Darkhelm', 'Redfist', 'Skullcrusher', 'Blackthorn', 'Deathgrip', 'Stonefist', 'Wargrave'];
const ENEMY_LAST = ['the Ruthless', 'the Butcher', 'Doomhammer', 'Bonecleaver', 'the Savage', 'Warborn', 'the Cruel', 'Hellblade', 'the Merciless', 'Deathbringer'];
const ENEMY_ARMY_NAMES = ['The Black Horde', 'Iron Wolves', 'Blood Ravens', 'Death\'s Hand', 'Shadow Legion', 'Skull Reapers'];

const randName = () => `${ENEMY_FIRST[Math.floor(Math.random() * ENEMY_FIRST.length)]} ${ENEMY_LAST[Math.floor(Math.random() * ENEMY_LAST.length)]}`;

type EncounterTier = {
  name: string;
  armySize: number;
  strength: [number, number]; // min, max
  defense: [number, number];
  health: [number, number];
  formation: string;
  xpReward: number;
  goldReward: number;
};

const ENCOUNTER_TIERS: Record<string, EncounterTier> = {
  patrol: { name: 'Enemy Patrol', armySize: 3, strength: [8, 12], defense: [6, 10], health: [60, 80], formation: 'line', xpReward: 30, goldReward: 50 },
  warband: { name: 'Enemy Warband', armySize: 5, strength: [10, 15], defense: [8, 12], health: [80, 100], formation: 'wedge', xpReward: 75, goldReward: 150 },
  company: { name: 'Enemy Company', armySize: 10, strength: [12, 18], defense: [10, 15], health: [100, 130], formation: 'shield_wall', xpReward: 200, goldReward: 500 },
  army: { name: 'Enemy Army', armySize: 20, strength: [15, 22], defense: [12, 18], health: [120, 160], formation: 'line', xpReward: 500, goldReward: 1500 },
  legion: { name: 'Enemy Legion', armySize: 50, strength: [18, 25], defense: [15, 22], health: [140, 180], formation: 'square', xpReward: 2000, goldReward: 5000 },
};

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

// Track active encounters for cleanup
const activeEncounters = new Map<string, { enemyIds: string[]; commanderUserId: string; tier: string }>();

const encounterRoutes: ServerRoute[] = [
  // ── Spawn encounter ──
  {
    method: 'POST',
    path: '/api/v1/encounter/spawn',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          tier: Joi.string().valid('patrol', 'warband', 'company', 'army', 'legion').required(),
          position: Joi.array().items(Joi.number()).length(3).optional(),
          facing: Joi.number().optional(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ENCOUNTER.SPAWN', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { tier, position, facing } = request.payload as {
          tier: string; position?: [number, number, number]; facing?: number;
        };

        const tierConfig = ENCOUNTER_TIERS[tier];
        if (!tierConfig) throw Boom.badRequest('Invalid tier');

        // Get commander position for spawn location
        const cmdState = players.get(credentials.id);
        const spawnCenter: [number, number, number] = position || (cmdState
          ? [
            cmdState.pos[0] + Math.sin(cmdState.rot * Math.PI / 180) * 30,
            cmdState.pos[1],
            cmdState.pos[2] + Math.cos(cmdState.rot * Math.PI / 180) * 30,
          ]
          : [30, 0.5, 30]);

        // Face toward the player
        const spawnFacing = facing ?? (cmdState
          ? (Math.atan2(cmdState.pos[0] - spawnCenter[0], cmdState.pos[2] - spawnCenter[2]) * 180 / Math.PI)
          : 180);

        const enemyCommanderId = `encounter-${Date.now()}`;
        const armyName = ENEMY_ARMY_NAMES[Math.floor(Math.random() * ENEMY_ARMY_NAMES.length)];

        // Calculate formation positions
        const positions = calculateFormationPositions(
          { type: tierConfig.formation, center: spawnCenter, facing: spawnFacing, width: tierConfig.armySize * 2.5 },
          tierConfig.armySize,
        );

        const enemyIds: string[] = [];

        for (let i = 0; i < tierConfig.armySize; i++) {
          const id = `${enemyCommanderId}-${i}`;
          const name = i === 0 ? `${randName()} [Commander]` : randName();
          const str = rand(tierConfig.strength[0], tierConfig.strength[1]);
          const def = rand(tierConfig.defense[0], tierConfig.defense[1]);
          const hp = rand(tierConfig.health[0], tierConfig.health[1]);

          // Create in-memory NPC state (no DB — these are temporary)
          const npcState: PlayerSyncState = {
            userId: id,
            characterId: id,
            username: name,
            ws: null as unknown as WebSocket,
            pos: positions[i].pos as [number, number, number],
            rot: positions[i].rot,
            action: 'idle',
            actionStartTime: Date.now(),
            hp,
            maxHp: hp,
            stamina: 100,
            maxStamina: 100,
            strength: str,
            defense: def,
            lastDamageTime: 0,
            isDead: false,
            spawnX: positions[i].pos[0],
            spawnY: positions[i].pos[1],
            spawnZ: positions[i].pos[2],
          };

          const brain: NPCBrain = {
            characterId: id,
            commanderUserId: enemyCommanderId,
            name,
            humor: 20, obedience: 70, bravery: rand(50, 90), curiosity: 10,
            greed: 30, aggressionNature: rand(60, 90), verbosity: 20,
            mood: 50, fear: 0, loyalty: 80, familiarity: 0, attraction: 0,
            warmth: 10, respect: 30,
            fatigue: 0, hunger: 0, procreationDrive: 0,
            aggression: rand(60, 85), defense: rand(40, 70),
            counterAttack: rand(40, 70), flankTendency: rand(20, 50),
            flankDirection: 50, retreatThreshold: 15, pursuit: 70,
            groupCohesion: 60, commanderProtection: 40, selfPreservation: 30,
            agenda: 'guard_position', // Hold formation until player gets close
            targetId: null, lastGrokCall: 0,
            grokIntervalMs: 999999, // No Grok calls for encounter NPCs
            situationLog: [],
            agendaLocked: true,
            formationPos: positions[i].pos as [number, number, number],
            formationRot: positions[i].rot,
            formationType: tierConfig.formation,
            formationAction: tierConfig.formation === 'shield_wall' ? 'block' : null,
            marchDirection: null,
            leaderId: enemyCommanderId, // All encounter units follow their commander
          };

          players.set(id, npcState);
          npcStates.set(id, npcState);
          activeNPCs.set(id, brain);
          enemyIds.push(id);

          // Broadcast to all clients
          broadcastAll({
            type: 'player_joined',
            id,
            username: name,
            pos: npcState.pos,
            rot: npcState.rot,
            hp: npcState.hp,
            maxHp: npcState.maxHp,
          });
        }

        // Store encounter for cleanup
        activeEncounters.set(enemyCommanderId, { enemyIds, commanderUserId: credentials.id, tier });

        // Switch to seek_combat when player gets within 15m (checked by behavior tree naturally)
        // For now they hold formation — the behavior tree will engage when enemies enter range

        console.log(`[Encounter] Spawned ${tierConfig.name} (${tierConfig.armySize} units) at [${spawnCenter.map(n => n.toFixed(0)).join(',')}] for ${credentials.username}`);

        return {
          encounter_id: enemyCommanderId,
          name: `${armyName} — ${tierConfig.name}`,
          army_size: tierConfig.armySize,
          formation: tierConfig.formation,
          position: spawnCenter,
          xp_reward: tierConfig.xpReward,
          gold_reward: tierConfig.goldReward,
        };
      }),
  },

  // ── Despawn/cleanup encounter ──
  {
    method: 'DELETE',
    path: '/api/v1/encounter/{id}',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ENCOUNTER.DESPAWN', async () => {
        const { id } = request.params;
        const encounter = activeEncounters.get(id);
        if (!encounter) throw Boom.notFound('Encounter not found');

        for (const enemyId of encounter.enemyIds) {
          players.delete(enemyId);
          npcStates.delete(enemyId);
          activeNPCs.delete(enemyId);
          broadcastAll({ type: 'player_left', id: enemyId });
        }
        activeEncounters.delete(id);

        console.log(`[Encounter] Despawned ${encounter.tier} (${encounter.enemyIds.length} units)`);
        return { success: true };
      }),
  },

  // ── List active encounters ──
  {
    method: 'GET',
    path: '/api/v1/encounters',
    options: { auth: 'jwt' },
    handler: async () =>
      tracer.trace('CONTROLLER.ENCOUNTER.LIST', async () => {
        const list = [];
        for (const [id, enc] of activeEncounters) {
          const alive = enc.enemyIds.filter((eid) => {
            const state = players.get(eid);
            return state && !state.isDead;
          }).length;
          list.push({ id, tier: enc.tier, total: enc.enemyIds.length, alive });
        }
        return { encounters: list };
      }),
  },

  // ── Spawn a test bot (for multiplayer sync testing) ──
  {
    method: 'POST',
    path: '/api/v1/encounter/test-bot',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          name: Joi.string().max(20).optional(),
          position: Joi.array().items(Joi.number()).length(3).optional(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ENCOUNTER.TEST_BOT', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { name, position } = request.payload as { name?: string; position?: [number, number, number] };

        const cmdState = players.get(credentials.id);
        const botId = `bot-${Date.now()}`;
        const botName = name || `TestBot-${Math.floor(Math.random() * 999)}`;
        const botPos: [number, number, number] = position || (cmdState
          ? [cmdState.pos[0] + 5, cmdState.pos[1], cmdState.pos[2] + 5]
          : [5, 0.5, 5]);

        const botState: PlayerSyncState = {
          userId: botId, characterId: botId, username: botName,
          ws: null as unknown as WebSocket,
          pos: botPos, rot: 0, action: 'idle', actionStartTime: Date.now(),
          hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
          strength: 10, defense: 10, lastDamageTime: 0, isDead: false,
          spawnX: botPos[0], spawnY: botPos[1], spawnZ: botPos[2],
        };

        players.set(botId, botState);

        broadcastAll({
          type: 'player_joined',
          id: botId,
          username: botName,
          pos: botPos,
          rot: 0,
          hp: 100,
          maxHp: 100,
        });

        // Make the bot walk in a circle
        let angle = 0;
        const botInterval = setInterval(() => {
          if (!players.has(botId)) { clearInterval(botInterval); return; }
          angle += 0.1;
          const radius = 5;
          botState.pos = [
            botPos[0] + Math.cos(angle) * radius,
            botPos[1],
            botPos[2] + Math.sin(angle) * radius,
          ];
          botState.rot = (angle * 180 / Math.PI) % 360;
          botState.action = 'walk';

          broadcastAll({
            type: 'player_update',
            id: botId,
            pos: botState.pos,
            rot: botState.rot,
            action: 'walk',
          });
        }, 200);

        // Auto-cleanup after 5 minutes
        setTimeout(() => {
          clearInterval(botInterval);
          players.delete(botId);
          broadcastAll({ type: 'player_left', id: botId });
          console.log(`[TestBot] ${botName} auto-removed after 5min`);
        }, 5 * 60 * 1000);

        console.log(`[TestBot] Spawned ${botName} at [${botPos.map(n => n.toFixed(0)).join(',')}]`);

        return { bot_id: botId, name: botName, position: botPos };
      }),
  },

  // ── Spawn persistent AI army (full Grok brains, DB-backed) ──
  {
    method: 'POST',
    path: '/api/v1/encounter/spawn-army',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          tier: Joi.string().valid('patrol', 'warband', 'company', 'army', 'legion').required(),
          position: Joi.array().items(Joi.number()).length(3).optional(),
          facing: Joi.number().optional(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ENCOUNTER.SPAWN_ARMY', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { tier, position, facing } = request.payload as {
          tier: string; position?: [number, number, number]; facing?: number;
        };

        // Calculate spawn position 30m ahead of player
        const cmdState = players.get(credentials.id);
        const spawnPos: [number, number, number] = position || (cmdState
          ? [
            cmdState.pos[0] + Math.sin(cmdState.rot * Math.PI / 180) * 30,
            cmdState.pos[1],
            cmdState.pos[2] + Math.cos(cmdState.rot * Math.PI / 180) * 30,
          ]
          : [30, 0.5, 30]);

        const spawnFacing = facing ?? (cmdState
          ? (Math.atan2(cmdState.pos[0] - spawnPos[0], cmdState.pos[2] - spawnPos[2]) * 180 / Math.PI)
          : 180);

        // Spawn the persistent army
        const result = await spawnAIArmyAction(tier, spawnPos, spawnFacing);

        // Register their NPCs in the game engine (full Grok brains)
        await registerPlayerNPCs(result.commander_user_id);

        // Create battle record
        const army = await Data.playerCharacter.getArmyStructure(result.commander_user_id);

        console.log(`[Encounter] Persistent AI army spawned: "${result.centurion_name}" (${tier}, ${result.army_size} units) with Grok brains`);

        return {
          commander_user_id: result.commander_user_id,
          centurion_name: result.centurion_name,
          army_size: result.army_size,
          tier,
          doctrine: result.doctrine,
          position: spawnPos,
          facing: spawnFacing,
        };
      }),
  },
];

export { encounterRoutes, activeEncounters };
