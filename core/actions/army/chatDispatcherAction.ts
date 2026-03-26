import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';
import grokAdapter from '../../adapters/grok';
import type { player_character } from '../../../prisma/client';

type ChatResponse = {
  unit_id: string;
  name: string;
  rank: string;
  unit_name: string;
  response: string;
  emotion: string;
};

type DispatchResult = {
  responders: string[];
  listeners: string[];
  commands_issued: string[];
};

/**
 * Step 1: Dispatch — determine who responds (fast, ~200ms).
 * Returns responder/listener lists immediately.
 * Caller is responsible for triggering Step 2 (generating responses) asynchronously.
 */
const dispatchArmyChat = async (userId: string, message: string): Promise<DispatchResult & { _army: player_character[]; _responderIds: string[] }> =>
  tracer.trace('ACTION.ARMY.CHAT_DISPATCH', async () => {
    const army = await Data.playerCharacter.getArmyStructure(userId);
    if (army.length === 0) throw Boom.notFound('No army found');

    const unitList = army.map((u) => ({
      id: u.id,
      name: u.name,
      rank: u.rank,
      maniple: u.maniple_id ? `Maniple ${u.maniple_id} "${u.maniple_name || ''}"` : 'Unassigned',
      squad: u.squad_id ? `Squad ${u.squad_id?.toUpperCase()}` : '',
    }));

    // ── Dispatcher call (grok-code, fast) ──
    const dispatchPrompt = `You are a message routing system for a medieval army. Given a commander's message and a list of units, determine who should RESPOND verbally and who should just LISTEN silently.

RULES:
- If a specific name is mentioned, only that unit responds
- If a rank is mentioned ("Sergeants", "Decurions"), all units of that rank respond
- If a group is mentioned ("Maniple 2", "Wolf Pack", "Squad 3A"), the leader of that group responds
- If "everyone", "all", or "army" is mentioned, the Centurion responds (or highest rank if no Centurion)
- If it's a general question/comment, pick 1-2 of the most verbal/relevant units to respond
- NEVER have more than 3 units respond to a single message
- If a quick command is detected (advance, retreat, hold, attack, defend, form up, flank), include it in commands

UNITS:
${unitList.map((u) => `- ${u.name} [${u.id}] (${u.rank}, ${u.maniple} ${u.squad})`).join('\n')}

Respond with ONLY valid JSON:
{
  "responder_ids": ["id1"],
  "listener_context": "brief summary for non-responders",
  "commands": []
}`;

    let responderIds: string[] = [];
    let listenerContext = '';
    let commands: string[] = [];

    try {
      const dispatchResponse = await grokAdapter.chatCompletion(
        dispatchPrompt,
        [{ role: 'user', content: message }],
        'grok-code-fast-1',
        200,
      );

      const text = dispatchResponse.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        responderIds = Array.isArray(parsed.responder_ids) ? parsed.responder_ids : [];
        listenerContext = parsed.listener_context || '';
        commands = Array.isArray(parsed.commands) ? parsed.commands : [];
      }
    } catch (err) {
      console.error('[ArmyChat] Dispatcher failed, falling back to centurion:', (err as Error).message);
    }

    // Fallback
    if (responderIds.length === 0) {
      const centurion = army.find((u) => u.rank === 'centurion');
      const fallback = centurion || army.find((u) => u.rank === 'decurion') || army[0];
      if (fallback) responderIds = [fallback.id];
    }

    // Validate IDs exist in army
    responderIds = responderIds.filter((id) => army.some((u) => u.id === id)).slice(0, 3);

    const listenerIds = army.filter((u) => !responderIds.includes(u.id)).map((u) => u.id);

    // Notify listeners (fire and forget)
    if (listenerContext) {
      for (const lid of listenerIds) {
        const unit = army.find((u) => u.id === lid);
        if (!unit) continue;
        const memories = unit.ai_memories ? JSON.parse(unit.ai_memories as string) : [];
        memories.push(`[Heard] ${listenerContext}`);
        if (memories.length > 30) memories.splice(0, memories.length - 30);
        Data.playerCharacter.update(lid, { ai_memories: JSON.stringify(memories) }).catch(() => {});
      }
    }

    // Execute quick commands
    if (commands.length > 0) {
      const commandMap: Record<string, Record<string, unknown>> = {
        advance: { ai_agenda: 'seek_combat', bw_aggression: 70 },
        retreat: { ai_agenda: 'follow_commander', bw_self_preservation: 80 },
        hold: { ai_agenda: 'guard_position' },
        attack: { ai_agenda: 'seek_combat', bw_aggression: 85 },
        defend: { ai_agenda: 'protect_commander', bw_defense: 80 },
        'form up': { ai_agenda: 'follow_commander' },
        'flank left': { bw_flank_tendency: 80, bw_flank_direction: 20 },
        'flank right': { bw_flank_tendency: 80, bw_flank_direction: 80 },
      };
      for (const cmd of commands) {
        const updates = commandMap[cmd.toLowerCase()];
        if (updates) {
          for (const unit of army) Data.playerCharacter.update(unit.id, updates).catch(() => {});
        }
      }
    }

    return {
      responders: responderIds,
      listeners: listenerIds,
      commands_issued: commands,
      _army: army,
      _responderIds: responderIds,
    };
  });

/**
 * Step 2: Generate a single unit's response (slow, 1-3s per unit).
 * Called asynchronously for each responder after dispatch returns.
 */
const generateUnitResponse = async (unit: player_character, playerMessage: string): Promise<ChatResponse> => {
  const memories = unit.ai_memories ? JSON.parse(unit.ai_memories as string) : [];
  const recentMemories = memories.slice(-5).join('\n') || 'None.';

  const rankTitle = unit.rank === 'centurion' ? 'Centurion' :
    unit.rank === 'decurion' ? 'Decurion' :
    unit.rank === 'sergeant' ? 'Sergeant' : 'Soldier';

  const unitAssignment = unit.maniple_id
    ? `${rankTitle} of Maniple ${unit.maniple_id} "${unit.maniple_name || ''}" Squad ${unit.squad_id?.toUpperCase() || '?'}`
    : rankTitle;

  const prompt = `You are ${unit.name}, a ${unitAssignment} in a medieval army.

PERSONALITY: humor=${unit.trait_humor}, obedience=${unit.trait_obedience}, bravery=${unit.trait_bravery}, verbosity=${unit.trait_verbosity}
DISPOSITION: mood=${unit.mood}, loyalty=${unit.loyalty}, respect=${unit.respect}, familiarity=${unit.familiarity}
RANK: ${unit.rank} — ${unit.rank === 'centurion' ? 'You command the entire army. Speak with authority and strategic insight.' :
  unit.rank === 'decurion' ? 'You command a maniple of 10. Speak with confidence about your unit.' :
  unit.rank === 'sergeant' ? 'You lead a squad of 5. Speak practically about your squad.' :
  'You are a soldier. Speak simply and respectfully.'}

Recent memories: ${recentMemories}
Commander's instructions: ${unit.ai_instructions || 'Serve loyally.'}

Respond in character. Keep it to 1-2 sentences. Match your rank.

After your response, on a NEW line write:
EMOTION: (one of: neutral, happy, angry, fearful, sarcastic, determined, respectful)`;

  try {
    const grokResponse = await grokAdapter.chatCompletion(
      prompt,
      [{ role: 'user', content: playerMessage }],
      unit.rank === 'centurion' ? 'grok-3-mini' : 'grok-code-fast-1',
      150,
    );

    const text = grokResponse.text || '*salutes*';
    let emotion = 'neutral';
    let cleanText = text;
    const emotionMatch = text.match(/EMOTION:\s*(\w+)/i);
    if (emotionMatch) {
      emotion = emotionMatch[1].toLowerCase();
      cleanText = text.replace(/\n?EMOTION:\s*\w+/i, '').trim();
    }

    memories.push(`[Chat] Commander: "${playerMessage}" — I said: "${cleanText.substring(0, 80)}"`);
    if (memories.length > 30) memories.splice(0, memories.length - 30);
    Data.playerCharacter.update(unit.id, { ai_memories: JSON.stringify(memories) }).catch(() => {});

    return {
      unit_id: unit.id,
      name: unit.name,
      rank: unit.rank,
      unit_name: unit.maniple_name || 'Unassigned',
      response: cleanText,
      emotion,
    };
  } catch (err) {
    console.error(`[ArmyChat] Grok failed for ${unit.name}:`, (err as Error).message);
    return {
      unit_id: unit.id, name: unit.name, rank: unit.rank,
      unit_name: unit.maniple_name || 'Unassigned',
      response: '*nods*', emotion: 'neutral',
    };
  }
};

export type { ChatResponse, DispatchResult };
export { dispatchArmyChat, generateUnitResponse };
