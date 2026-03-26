// ┌──────────────────────────────────────────┐
// │ Tier 3: Grok Brain (5-30s cycle)         │
// │ Evaluates situation, adjusts weights,    │
// │ generates speech, stores memories        │
// └──────────────────────────────────────────┘

import type { NPCBrain } from './behaviorTree';
import Data from '../../../../../../core/data';

type GrokResponse = {
  agenda: string;
  mood: number;
  fear: number;
  aggression: number;
  defense: number;
  counterAttack: number;
  flankTendency: number;
  commanderProtection: number;
  selfPreservation: number;
  say: string | null;
  memory: string | null;
  attraction: number;
  warmth: number;
  respect: number;
};

/** Build the prompt for Grok based on the NPC's state and situation. */
const buildPrompt = (brain: NPCBrain, situationReport: string): string => {
  const traits = [
    `humor=${brain.humor}`,
    `obedience=${brain.obedience}`,
    `bravery=${brain.bravery}`,
    `curiosity=${brain.curiosity}`,
    `greed=${brain.greed}`,
    `aggression_nature=${brain.aggressionNature}`,
    `verbosity=${brain.verbosity}`,
  ].join(', ');

  const disposition = [
    `mood=${brain.mood}`,
    `fear=${brain.fear}`,
    `loyalty=${brain.loyalty}`,
    `familiarity=${brain.familiarity}`,
    `attraction=${brain.attraction}`,
    `warmth=${brain.warmth}`,
    `respect=${brain.respect}`,
    `fatigue=${brain.fatigue}`,
    `hunger=${brain.hunger}`,
    `procreation_drive=${brain.procreationDrive}`,
  ].join(', ');

  const memories = brain.situationLog.length > 0
    ? brain.situationLog.slice(-10).join('\n')
    : 'No recent memories.';

  return `You are ${brain.name}, a ${brain.characterId ? 'recruit companion' : 'NPC'} in a medieval combat world.
You are a loyal companion following your commander. You are NOT in danger unless the situation explicitly says "ENEMIES NEARBY".

PERSONALITY TRAITS (0-100, fixed): ${traits}
CURRENT DISPOSITION (0-100): ${disposition}

Commander's instructions:
${brain.obedience > 50 ? '(You follow instructions carefully)' : '(You have a mind of your own)'}
---
${/* ai_instructions loaded separately */ ''}
---

Current situation:
${situationReport}

Memories:
${memories}

IMPORTANT RULES:
- If the area is peaceful, keep FEAR low (0-15) and MOOD moderate to high (40-80)
- Only raise FEAR above 30 if ENEMIES are explicitly listed
- Only set AGGRESSION above 50 if enemies are nearby
- SAY should match the mood — casual/friendly when peaceful, intense when fighting
- Most of the time in peaceful situations, respond with SAY: NONE (don't talk every cycle)
- Only SAY something ~20% of the time when peaceful — comment on scenery, make small talk, or stay quiet

Respond with ONLY these fields, one per line. Use numbers 0-100 for numeric fields:
AGENDA: (one of: follow_commander, protect_commander, seek_combat, rest, socialize, explore, guard_position, flee)
MOOD: (0-100)
FEAR: (0-100)
AGGRESSION: (0-100)
DEFENSE: (0-100)
COUNTER_ATTACK: (0-100)
FLANK: (0-100)
COMMANDER_PROTECTION: (0-100)
SELF_PRESERVATION: (0-100)
ATTRACTION: (0-100)
WARMTH: (0-100)
RESPECT: (0-100)
SAY: (short in-character line, or NONE)
MEMORY: (one thing worth remembering about this moment, or NONE)`;
};

/** Parse Grok's KEY: VALUE response format. Respects agendaLocked flag. */
const parseGrokResponse = (text: string, currentBrain: NPCBrain): GrokResponse => {
  const result: GrokResponse = {
    agenda: currentBrain.agenda,
    mood: currentBrain.mood,
    fear: currentBrain.fear,
    aggression: currentBrain.aggression,
    defense: currentBrain.defense,
    counterAttack: currentBrain.counterAttack,
    flankTendency: currentBrain.flankTendency,
    commanderProtection: currentBrain.commanderProtection,
    selfPreservation: currentBrain.selfPreservation,
    say: null,
    memory: null,
    attraction: currentBrain.attraction,
    warmth: currentBrain.warmth,
    respect: currentBrain.respect,
  };

  const validAgendas = ['follow_commander', 'protect_commander', 'seek_combat', 'rest', 'socialize', 'explore', 'guard_position', 'flee'];

  for (const line of text.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim().toUpperCase();
    const val = line.substring(colonIdx + 1).trim();

    const num = parseInt(val, 10);
    const clamp = (n: number) => Math.max(0, Math.min(100, isNaN(n) ? 50 : n));

    switch (key) {
      case 'AGENDA':
        // Only allow Grok to change agenda if NOT locked by player command
        if (!currentBrain.agendaLocked && validAgendas.includes(val.toLowerCase())) {
          result.agenda = val.toLowerCase();
        }
        break;
      case 'MOOD': result.mood = clamp(num); break;
      case 'FEAR': result.fear = clamp(num); break;
      case 'AGGRESSION': result.aggression = clamp(num); break;
      case 'DEFENSE': result.defense = clamp(num); break;
      case 'COUNTER_ATTACK': result.counterAttack = clamp(num); break;
      case 'FLANK': result.flankTendency = clamp(num); break;
      case 'COMMANDER_PROTECTION': result.commanderProtection = clamp(num); break;
      case 'SELF_PRESERVATION': result.selfPreservation = clamp(num); break;
      case 'ATTRACTION': result.attraction = clamp(num); break;
      case 'WARMTH': result.warmth = clamp(num); break;
      case 'RESPECT': result.respect = clamp(num); break;
      case 'SAY': if (val && val !== 'NONE') result.say = val; break;
      case 'MEMORY': if (val && val !== 'NONE') result.memory = val; break;
    }
  }

  return result;
};

/** Apply Grok's response to the brain and persist to DB. */
const applyGrokResponse = async (brain: NPCBrain, response: GrokResponse): Promise<void> => {
  brain.agenda = response.agenda;
  brain.mood = response.mood;
  brain.fear = response.fear;
  brain.aggression = response.aggression;
  brain.defense = response.defense;
  brain.counterAttack = response.counterAttack;
  brain.flankTendency = response.flankTendency;
  brain.commanderProtection = response.commanderProtection;
  brain.selfPreservation = response.selfPreservation;
  brain.attraction = response.attraction;
  brain.warmth = response.warmth;
  brain.respect = response.respect;

  // Store memory if provided
  if (response.memory) {
    brain.situationLog.push(`[Memory] ${response.memory}`);
    // Keep max 50 entries
    if (brain.situationLog.length > 50) brain.situationLog.shift();
  }

  // Persist to DB (fire and forget)
  Data.playerCharacter.update(brain.characterId, {
    bw_aggression: response.aggression,
    bw_defense: response.defense,
    bw_counter_attack: response.counterAttack,
    bw_flank_tendency: response.flankTendency,
    bw_commander_protection: response.commanderProtection,
    bw_self_preservation: response.selfPreservation,
    mood: response.mood,
    fear: response.fear,
    attraction: response.attraction,
    warmth: response.warmth,
    respect: response.respect,
    ai_agenda: response.agenda,
    ai_memories: JSON.stringify(brain.situationLog.slice(-20)),
  } as Record<string, unknown>).catch(console.error);
};

/** Generate a random personality for a new recruit based on type. */
const generatePersonality = (npcType: string): Record<string, number> => {
  const rand = (base: number, variance: number = 25) =>
    Math.max(0, Math.min(100, base + Math.floor((Math.random() - 0.5) * variance * 2)));

  const presets: Record<string, Record<string, number>> = {
    peasant_levy: { humor: 60, obedience: 70, bravery: 30, curiosity: 50, greed: 40, aggression: 30, verbosity: 60 },
    militia_swordsman: { humor: 50, obedience: 60, bravery: 50, curiosity: 40, greed: 45, aggression: 50, verbosity: 50 },
    man_at_arms: { humor: 40, obedience: 70, bravery: 65, curiosity: 30, greed: 35, aggression: 55, verbosity: 40 },
    veteran_knight: { humor: 30, obedience: 55, bravery: 80, curiosity: 25, greed: 30, aggression: 60, verbosity: 30 },
    elite_champion: { humor: 25, obedience: 40, bravery: 90, curiosity: 20, greed: 25, aggression: 70, verbosity: 25 },
    crossbowman: { humor: 55, obedience: 60, bravery: 40, curiosity: 50, greed: 50, aggression: 40, verbosity: 55 },
    shield_bearer: { humor: 35, obedience: 80, bravery: 70, curiosity: 30, greed: 25, aggression: 25, verbosity: 35 },
  };

  const base = presets[npcType] || presets.militia_swordsman;

  return {
    trait_humor: rand(base.humor),
    trait_obedience: rand(base.obedience),
    trait_bravery: rand(base.bravery),
    trait_curiosity: rand(base.curiosity),
    trait_greed: rand(base.greed),
    trait_aggression: rand(base.aggression),
    trait_verbosity: rand(base.verbosity),
    mood: rand(55, 15),
    loyalty: rand(40, 15),
    familiarity: rand(10, 5),
    procreation_drive: rand(30, 20),
  };
};

export type { GrokResponse };
export { buildPrompt, parseGrokResponse, applyGrokResponse, generatePersonality };
