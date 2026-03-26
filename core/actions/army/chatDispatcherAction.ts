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

    // ── Fast pattern matching (no Grok call, <1ms) ──
    let responderIds: string[] = [];
    let listenerContext = '';
    let commands: string[] = [];
    let usedFastPath = false;

    const msg = message.toLowerCase().trim();
    const centurion = army.find((u) => u.rank === 'centurion');
    const highestRank = centurion || army.find((u) => u.rank === 'decurion') || army.find((u) => u.rank === 'sergeant') || army[0];

    // Detect quick commands
    const commandPatterns: [RegExp, string][] = [
      [/\b(hold|stay|stop|halt)\b/i, 'hold'],
      [/\b(advance|forward|march|move out|charge)\b/i, 'advance'],
      [/\b(retreat|fall back|pull back|withdraw)\b/i, 'retreat'],
      [/\b(attack|fight|engage|kill)\b/i, 'attack'],
      [/\b(defend|protect|shield)\b/i, 'defend'],
      [/\b(form up|regroup|rally|on me)\b/i, 'form up'],
      [/\b(resume|as you were|carry on|free|autonomous|ai control)\b/i, 'resume'],
      [/\b(flank left|go left)\b/i, 'flank left'],
      [/\b(flank right|go right)\b/i, 'flank right'],
    ];
    for (const [pattern, cmd] of commandPatterns) {
      if (pattern.test(msg)) commands.push(cmd);
    }

    // Check if a specific unit name is mentioned
    const namedUnit = army.find((u) => msg.includes(u.name.toLowerCase()));
    if (namedUnit) {
      responderIds = [namedUnit.id];
      listenerContext = `Commander addressed ${namedUnit.name}`;
      usedFastPath = true;
    }

    // Check for rank addressing
    if (!usedFastPath && /\bcenturion\b/i.test(msg) && centurion) {
      responderIds = [centurion.id];
      listenerContext = 'Commander addressed the Centurion';
      usedFastPath = true;
    }
    if (!usedFastPath && /\bdecurion/i.test(msg)) {
      responderIds = army.filter((u) => u.rank === 'decurion').map((u) => u.id).slice(0, 3);
      listenerContext = 'Commander addressed Decurions';
      usedFastPath = true;
    }
    if (!usedFastPath && /\bsergeant/i.test(msg)) {
      responderIds = army.filter((u) => u.rank === 'sergeant').map((u) => u.id).slice(0, 3);
      listenerContext = 'Commander addressed Sergeants';
      usedFastPath = true;
    }

    // Check for squad/maniple addressing
    if (!usedFastPath) {
      const squadMatch = msg.match(/\bsquad\s*([a-b])\b/i);
      if (squadMatch) {
        const sqId = squadMatch[1].toLowerCase();
        const squadLeader = army.find((u) => u.squad_id === sqId && (u.rank === 'sergeant' || u.rank === 'decurion'));
        if (squadLeader) {
          responderIds = [squadLeader.id];
          listenerContext = `Commander addressed Squad ${sqId.toUpperCase()}`;
          usedFastPath = true;
        }
      }
    }
    if (!usedFastPath) {
      const manipleMatch = msg.match(/\bmaniple\s*(\d+)\b/i);
      if (manipleMatch) {
        const mId = parseInt(manipleMatch[1], 10);
        const decurion = army.find((u) => u.maniple_id === mId && u.rank === 'decurion');
        if (decurion) {
          responderIds = [decurion.id];
          listenerContext = `Commander addressed Maniple ${mId}`;
          usedFastPath = true;
        }
      }
      // Check maniple names
      if (!usedFastPath) {
        for (const u of army) {
          if (u.maniple_name && msg.includes(u.maniple_name.toLowerCase())) {
            const decurion = army.find((d) => d.maniple_id === u.maniple_id && d.rank === 'decurion');
            if (decurion) {
              responderIds = [decurion.id];
              listenerContext = `Commander addressed ${u.maniple_name}`;
              usedFastPath = true;
              break;
            }
          }
        }
      }
    }

    // "Everyone", "all", army-wide
    if (!usedFastPath && /\b(everyone|all|army|troops|men)\b/i.test(msg)) {
      if (highestRank) responderIds = [highestRank.id];
      listenerContext = 'Commander addressed the army';
      usedFastPath = true;
    }

    // Commands without specific addressing → centurion/highest responds
    if (!usedFastPath && commands.length > 0 && highestRank) {
      responderIds = [highestRank.id];
      listenerContext = `Commander issued: ${commands.join(', ')}`;
      usedFastPath = true;
    }

    // ── Fall back to Grok only for ambiguous messages ──
    if (!usedFastPath) {
      console.log(`[ArmyChat] Fast path miss, using Grok for: "${message}"`);
      const unitList = army.map((u) => `${u.name} [${u.id}] (${u.rank})`).join(', ');
      try {
        const t0 = Date.now();
        const dispatchResponse = await grokAdapter.chatCompletion(
          `Route this army message. Units: ${unitList}\nPick 1-2 responder IDs. JSON only: {"responder_ids":["id"],"listener_context":"summary","commands":[]}`,
          [{ role: 'user', content: message }],
          'grok-code-fast-1',
          100,
        );
        console.log(`[ArmyChat] Grok dispatch took ${Date.now() - t0}ms`);

        const text = dispatchResponse.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          responderIds = Array.isArray(parsed.responder_ids) ? parsed.responder_ids : [];
          listenerContext = parsed.listener_context || '';
          if (Array.isArray(parsed.commands)) commands.push(...parsed.commands);
        }
      } catch (err) {
        console.error('[ArmyChat] Grok dispatch failed:', (err as Error).message);
      }
    } else {
      console.log(`[ArmyChat] Fast path: ${listenerContext} (${commands.length} commands)`);
    }

    // Final fallback
    if (responderIds.length === 0 && highestRank) {
      responderIds = [highestRank.id];
    }
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

  const prompt = `You are ${unit.name}, ${rankTitle} in a medieval army. ${unit.rank === 'centurion' ? 'Speak with authority.' : unit.rank === 'soldier' ? 'Speak simply.' : 'Speak confidently.'}
Humor:${unit.trait_humor} Bravery:${unit.trait_bravery} Mood:${unit.mood}
Reply in 1 sentence, in character. End with EMOTION: (neutral/happy/angry/fearful/sarcastic/determined)`;

  try {
    const t0 = Date.now();
    const grokResponse = await grokAdapter.chatCompletion(
      prompt,
      [{ role: 'user', content: playerMessage }],
      'grok-code-fast-1', // Always use fast model — even centurion (speed > quality for chat)
      60,
    );
    console.log(`[ArmyChat] ${unit.name} response took ${Date.now() - t0}ms`);

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
