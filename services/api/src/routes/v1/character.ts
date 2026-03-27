import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import createCharacterAction from '../../../../../core/actions/character/createCharacterAction';
import getCharacterAction from '../../../../../core/actions/character/getCharacterAction';
import addXPAction from '../../../../../core/actions/character/addXPAction';
import Data from '../../../../../core/data';
import grokAdapter from '../../../../../core/adapters/grok';
import { refreshArmyState, activeNPCs, npcStates } from '../../handlers/gameSync/ai/npcEngine';
import { players, broadcastAll } from '../../handlers/gameSync/combat';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const characterRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/api/v1/characters',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          name: Joi.string().min(2).max(20).required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.CHARACTER.CREATE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { name } = request.payload as { name: string };
        const character = await createCharacterAction(credentials.id, name);
        return h.response(character).code(201);
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/characters/me',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.CHARACTER.GET_ME', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return getCharacterAction(credentials.id);
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/characters/{id}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({ id: Joi.string().uuid().required() }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.CHARACTER.GET_BY_ID', async () => {
        const { id } = request.params;
        const character = await Data.playerCharacter.findById(id);
        if (!character) throw Boom.notFound('Character not found');
        return character;
      }),
  },
  // ── Add XP (for testing) ──
  {
    method: 'POST',
    path: '/api/v1/characters/add-xp',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({ amount: Joi.number().integer().min(1).max(100000).required() }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.CHARACTER.ADD_XP', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const character = await Data.playerCharacter.findByUserId(credentials.id);
        if (!character) throw Boom.notFound('Character not found');
        const { amount } = request.payload as { amount: number };
        return addXPAction(character.id, amount);
      }),
  },
  // ── Levels ──
  {
    method: 'GET',
    path: '/api/v1/levels',
    options: { auth: false },
    handler: async () =>
      tracer.trace('CONTROLLER.LEVELS.LIST', async () => {
        const levels = await Data.levelDefinition.findAll();
        return { levels };
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/levels/seed',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.LEVELS.SEED', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        const results = [];
        for (let i = 1; i <= 50; i++) {
          const xpRequired = i === 1 ? 0 : Math.floor(50 * Math.pow(i - 1, 1.8));
          const level = await Data.levelDefinition.upsert({ level: i, xp_required: xpRequired });
          results.push(level);
        }

        return h.response({ seeded: results.length, levels: results }).code(201);
      }),
  },
  // ── Get my recruits ──
  {
    method: 'GET',
    path: '/api/v1/recruits',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.RECRUITS.LIST', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const recruits = await Data.playerCharacter.findRecruitsByCommander(credentials.id);
        // Include equipped items for each recruit
        const recruitsWithGear = await Promise.all(recruits.map(async (r) => {
          const equipped = await Data.inventoryItem.findEquipped(r.id);
          return {
            ...r,
            equipped: equipped.map((e) => ({
              equip_slot: e.equip_slot,
              item_def: e.item_def,
            })),
          };
        }));
        return { recruits: recruitsWithGear };
      }),
  },
  // ── Dismiss a recruit ──
  {
    method: 'DELETE',
    path: '/api/v1/recruits/{id}',
    options: {
      auth: 'jwt',
      validate: { params: Joi.object({ id: Joi.string().uuid().required() }) },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.RECRUITS.DISMISS', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { id } = request.params;
        const recruit = await Data.playerCharacter.findById(id);
        if (!recruit) throw Boom.notFound('Recruit not found');
        if (!recruit.is_npc || recruit.commander_id !== credentials.id) {
          throw Boom.forbidden('Not your recruit');
        }
        // Remove from live NPC engine
        activeNPCs.delete(id);
        npcStates.delete(id);
        players.delete(id);
        broadcastAll({ type: 'player_left', id });

        await Data.playerCharacter.deleteRecruit(id);

        // Fill any leadership gaps left by the dismissed unit
        await Data.playerCharacter.fillLeadershipGaps(credentials.id);

        // Refresh remaining army (promotions may have happened)
        refreshArmyState(credentials.id).catch(console.error);

        return { dismissed: true };
      }),
  },
  // ── Update recruit instructions ──
  {
    method: 'PUT',
    path: '/api/v1/recruits/{id}/instructions',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({ id: Joi.string().uuid().required() }),
        payload: Joi.object({ instructions: Joi.string().max(2000).required() }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.RECRUITS.INSTRUCTIONS', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { id } = request.params;
        const { instructions } = request.payload as { instructions: string };
        const recruit = await Data.playerCharacter.findById(id);
        if (!recruit) throw Boom.notFound('Recruit not found');
        if (!recruit.is_npc || recruit.commander_id !== credentials.id) throw Boom.forbidden('Not your recruit');
        await Data.playerCharacter.update(id, { ai_instructions: instructions } as Record<string, unknown>);
        return { success: true };
      }),
  },
  // ── Chat with recruit ──
  {
    method: 'POST',
    path: '/api/v1/recruits/{id}/chat',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({ id: Joi.string().uuid().required() }),
        payload: Joi.object({ message: Joi.string().max(500).required() }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.RECRUITS.CHAT', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { id } = request.params;
        const { message } = request.payload as { message: string };

        const recruit = await Data.playerCharacter.findById(id);
        if (!recruit) throw Boom.notFound('Recruit not found');
        if (!recruit.is_npc || recruit.commander_id !== credentials.id) throw Boom.forbidden('Not your recruit');

        const memories = recruit.ai_memories ? JSON.parse(recruit.ai_memories as string) : [];
        const recentMemories = memories.slice(-10).join('\n') || 'No memories yet.';

        const systemPrompt = `You are ${recruit.name}, a ${recruit.npc_type?.replace(/_/g, ' ') || 'recruit'} companion in a medieval combat world.

PERSONALITY (0-100): humor=${recruit.trait_humor}, obedience=${recruit.trait_obedience}, bravery=${recruit.trait_bravery}, curiosity=${recruit.trait_curiosity}, verbosity=${recruit.trait_verbosity}
DISPOSITION: mood=${recruit.mood}, loyalty=${recruit.loyalty}, familiarity=${recruit.familiarity}, attraction=${recruit.attraction}, warmth=${recruit.warmth}, respect=${recruit.respect}

Your commander's instructions for you:
${recruit.ai_instructions || 'Follow and protect your commander.'}

Your memories:
${recentMemories}

Respond in character. Keep responses short (1-3 sentences). Be natural — use the personality traits to shape your tone. A high-humor recruit cracks jokes. A low-obedience recruit might push back. High attraction means flirty undertones. High fear means nervous.

After your response, on a NEW line write:
EMOTION: (one of: neutral, happy, angry, fearful, sarcastic, flirty, sad, determined)`;

        const grokResponse = await grokAdapter.chatCompletion(
          systemPrompt,
          [{ role: 'user', content: message }],
          'grok-3-mini',
          200,
        );

        const responseText = grokResponse.text || '';

        // Parse emotion from response
        let emotion = 'neutral';
        let cleanResponse = responseText;
        const emotionMatch = responseText.match(/EMOTION:\s*(\w+)/i);
        if (emotionMatch) {
          emotion = emotionMatch[1].toLowerCase();
          cleanResponse = responseText.replace(/\n?EMOTION:\s*\w+/i, '').trim();
        }

        // Store conversation in memories
        memories.push(`[Chat] Commander said: "${message}" — I replied: "${cleanResponse.substring(0, 100)}"`);
        if (memories.length > 30) memories.splice(0, memories.length - 30);
        Data.playerCharacter.update(id, { ai_memories: JSON.stringify(memories) } as Record<string, unknown>).catch(console.error);

        return { response: cleanResponse, emotion };
      }),
  },
  // ── Quick command to recruits ──
  {
    method: 'POST',
    path: '/api/v1/recruits/command',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          command: Joi.string().valid('follow', 'hold', 'attack_target', 'defend_me', 'fall_back', 'aggressive', 'defensive').required(),
          recruit_ids: Joi.array().items(Joi.string().uuid()).optional(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.RECRUITS.COMMAND', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { command, recruit_ids } = request.payload as { command: string; recruit_ids?: string[] };

        const recruits = await Data.playerCharacter.findRecruitsByCommander(credentials.id);
        const targets = recruit_ids
          ? recruits.filter((r) => recruit_ids.includes(r.id))
          : recruits;

        const commandMap: Record<string, Record<string, unknown>> = {
          follow: { ai_agenda: 'follow_commander' },
          hold: { ai_agenda: 'guard_position' },
          attack_target: { ai_agenda: 'seek_combat', bw_aggression: 80 },
          defend_me: { ai_agenda: 'protect_commander', bw_commander_protection: 90, bw_defense: 70 },
          fall_back: { ai_agenda: 'follow_commander', bw_self_preservation: 80 },
          aggressive: { bw_aggression: 85, bw_defense: 30 },
          defensive: { bw_aggression: 25, bw_defense: 85, bw_counter_attack: 70 },
        };

        const updates = commandMap[command] || {};
        for (const recruit of targets) {
          await Data.playerCharacter.update(recruit.id, updates);
        }

        return { success: true, affected: targets.length };
      }),
  },
  // ── Revive a player (admin only) ──
  {
    method: 'POST',
    path: '/api/v1/characters/revive/{username}',
    options: {
      auth: 'jwt',
      validate: { params: Joi.object({ username: Joi.string().required() }) },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.CHARACTER.REVIVE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        const { username } = request.params;
        const user = await Data.user.findByUsername(username);
        if (!user) throw Boom.notFound('User not found');

        // Revive in game-sync
        for (const [id, p] of players) {
          if (p.username === username && p.isDead) {
            p.isDead = false;
            p.hp = p.maxHp;
            p.stamina = p.maxStamina;
            p.action = 'idle';
            broadcastAll({ type: 'player_respawned', id, pos: p.pos, hp: p.hp });
            console.log(`[Revive] ${username} revived by admin ${credentials.username}`);
            return { revived: true, username, hp: p.hp };
          }
        }

        return { revived: false, reason: 'Player not found or not dead' };
      }),
  },
];

export { characterRoutes };
