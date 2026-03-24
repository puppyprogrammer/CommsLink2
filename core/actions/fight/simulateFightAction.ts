import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import claudeAdapter from '../../adapters/claude';
import Data from '../../data';

import type { gladiator_stats, gladiator_memory } from '../../../prisma/client';

// ┌──────────────────────────────────────────┐
// │ Types                                    │
// └──────────────────────────────────────────┘

type GladiatorState = {
  id: string;
  name: string;
  health: number;
  stamina: number;
  stats: gladiator_stats;
  memories: gladiator_memory[];
  position: { x: number; y: number; z: number };
};

type AIDecision = {
  action: string;
  reasoning: string;
};

type FightEventRecord = {
  fight_id: string;
  timestamp_ms: number;
  actor_gladiator_id: string;
  action: string;
  result: string;
  damage_dealt: number;
  stamina_cost: number;
  health_after_actor: number;
  health_after_target: number;
  stamina_after_actor: number;
  stamina_after_target: number;
  ai_reasoning: string;
  position_actor: Record<string, unknown>;
  position_target: Record<string, unknown>;
};

// ┌──────────────────────────────────────────┐
// │ Constants                                │
// └──────────────────────────────────────────┘

const VALID_ACTIONS = ['strike', 'heavy_strike', 'block', 'dodge', 'clinch'];

const STAMINA_COSTS: Record<string, number> = {
  strike: 8,
  heavy_strike: 18,
  block: 5,
  dodge: 12,
  clinch: 15,
};

const BASE_DAMAGE: Record<string, number> = {
  strike: 12,
  heavy_strike: 25,
  clinch: 5,
};

const ELO_K_FACTOR = 32;
const MAX_EXCHANGES = 60;
const EXCHANGE_INTERVAL_MS = 1000;
const STAMINA_REGEN_PER_TICK = 3;

// ┌──────────────────────────────────────────┐
// │ System Prompt Builder                    │
// └──────────────────────────────────────────┘

/**
 * Build the system prompt for a gladiator AI agent.
 *
 * @param gladiator - Gladiator state with memories.
 * @returns System prompt string.
 */
const buildSystemPrompt = (gladiator: GladiatorState): string => {
  const strategyMemories = gladiator.memories
    .filter((m) => m.memory_type === 'strategy')
    .map((m) => `- ${m.content}`)
    .join('\n');

  const opponentMemories = gladiator.memories
    .filter((m) => m.memory_type === 'opponent')
    .map((m) => `- ${m.content}`)
    .join('\n');

  const generalMemories = gladiator.memories
    .filter((m) => m.memory_type === 'general')
    .map((m) => `- ${m.content}`)
    .join('\n');

  return `You are ${gladiator.name}, a gladiator fighter.

${strategyMemories ? `Your fighting style:\n${strategyMemories}` : 'You have no specific fighting strategy yet.'}

${opponentMemories ? `Your known opponents:\n${opponentMemories}` : ''}

${generalMemories ? `Your general knowledge:\n${generalMemories}` : ''}

Your stats:
- Strength: ${gladiator.stats.strength} (affects damage dealt)
- Speed: ${gladiator.stats.speed} (affects who strikes first)
- Endurance: ${gladiator.stats.endurance} (affects stamina recovery)
- Technique: ${gladiator.stats.technique} (affects dodge success rate)

Choose ONE action: strike, heavy_strike, block, dodge, clinch
Respond with JSON only:
{"action": "...", "reasoning": "..."}`;
};

/**
 * Build the fight state context for a gladiator's turn.
 *
 * @param self - This gladiator.
 * @param opponent - Opponent gladiator.
 * @param recentMoves - Last 5 opponent moves.
 * @param exchangeNum - Current exchange number.
 * @param totalExchanges - Max exchanges.
 * @returns User message content.
 */
const buildFightContext = (
  self: GladiatorState,
  opponent: GladiatorState,
  recentMoves: string[],
  exchangeNum: number,
  totalExchanges: number,
): string => {
  const phase = exchangeNum < totalExchanges * 0.3 ? 'early' : exchangeNum < totalExchanges * 0.7 ? 'mid' : 'late';

  return `Current fight state:
- Your health: ${self.health}/100
- Your stamina: ${self.stamina}/100
- Opponent health: ${opponent.health}/100
- Opponent stamina: ${opponent.stamina}/100
- Last 5 opponent moves: [${recentMoves.join(', ')}]
- Fight duration: ${phase}
- Exchange: ${exchangeNum}/${totalExchanges}

Choose your action now.`;
};

// ┌──────────────────────────────────────────┐
// │ Combat Resolution                        │
// └──────────────────────────────────────────┘

/**
 * Resolve a combat exchange between two gladiators.
 *
 * @param actionA - Gladiator A's action.
 * @param actionB - Gladiator B's action.
 * @param stateA - Gladiator A's current state.
 * @param stateB - Gladiator B's current state.
 * @returns Array of 1-2 event results (one per gladiator who acts).
 */
const resolveExchange = (
  actionA: string,
  actionB: string,
  stateA: GladiatorState,
  stateB: GladiatorState,
): { damageToA: number; damageToB: number; resultA: string; resultB: string } => {
  let damageToA = 0;
  let damageToB = 0;
  let resultA = 'miss';
  let resultB = 'miss';

  const strengthA = stateA.stats.strength;
  const strengthB = stateB.stats.strength;
  const speedA = stateA.stats.speed;
  const speedB = stateB.stats.speed;
  const techniqueA = stateA.stats.technique;
  const techniqueB = stateB.stats.technique;
  const enduranceA = stateA.stats.endurance;
  const enduranceB = stateB.stats.endurance;

  const lowStaminaA = stateA.stamina < 30;
  const lowStaminaB = stateB.stamina < 30;
  const zeroStaminaA = stateA.stamina <= 0;
  const zeroStaminaB = stateB.stamina <= 0;

  // Calculate damage with strength scaling
  const strikeDmgA = Math.round(BASE_DAMAGE.strike * (1 + (strengthA - 50) / 100));
  const strikeDmgB = Math.round(BASE_DAMAGE.strike * (1 + (strengthB - 50) / 100));
  const heavyDmgA = Math.round(BASE_DAMAGE.heavy_strike * (1 + (strengthA - 50) / 100));
  const heavyDmgB = Math.round(BASE_DAMAGE.heavy_strike * (1 + (strengthB - 50) / 100));

  // Helper: can B dodge A's attack?
  const canDodge = (dodgerTechnique: number, dodgerLowStamina: boolean, dodgerZeroStamina: boolean): boolean => {
    if (dodgerZeroStamina) return false;
    const chance = 0.5 + (dodgerTechnique - 50) / 200;
    const effective = dodgerLowStamina ? chance * 0.5 : chance;
    return Math.random() < effective;
  };

  // Helper: block damage pass-through
  const blockPassthrough = (baseDmg: number, isHeavy: boolean, blockerLowStamina: boolean, blockerZeroStamina: boolean): number => {
    if (blockerZeroStamina) return baseDmg;
    const rate = isHeavy ? 0.7 : 0.4;
    const effective = blockerLowStamina ? Math.min(rate + 0.25, 1.0) : rate;
    return Math.round(baseDmg * effective);
  };

  // ---- Resolution matrix ----

  // Strike vs Strike: faster hits first
  if (actionA === 'strike' && actionB === 'strike') {
    if (speedA >= speedB) {
      damageToB = strikeDmgA;
      resultA = 'hit';
      damageToA = strikeDmgB;
      resultB = 'hit';
    } else {
      damageToA = strikeDmgB;
      resultB = 'hit';
      damageToB = strikeDmgA;
      resultA = 'hit';
    }
  }
  // Strike vs Block
  else if (actionA === 'strike' && actionB === 'block') {
    damageToB = blockPassthrough(strikeDmgA, false, lowStaminaB, zeroStaminaB);
    resultA = damageToB > 0 ? 'hit' : 'blocked';
    resultB = 'blocked';
  } else if (actionB === 'strike' && actionA === 'block') {
    damageToA = blockPassthrough(strikeDmgB, false, lowStaminaA, zeroStaminaA);
    resultB = damageToA > 0 ? 'hit' : 'blocked';
    resultA = 'blocked';
  }
  // Strike vs Dodge
  else if (actionA === 'strike' && actionB === 'dodge') {
    if (canDodge(techniqueB, lowStaminaB, zeroStaminaB)) {
      resultA = 'miss';
      resultB = 'dodged';
    } else {
      damageToB = strikeDmgA;
      resultA = 'hit';
      resultB = 'hit';
    }
  } else if (actionB === 'strike' && actionA === 'dodge') {
    if (canDodge(techniqueA, lowStaminaA, zeroStaminaA)) {
      resultB = 'miss';
      resultA = 'dodged';
    } else {
      damageToA = strikeDmgB;
      resultB = 'hit';
      resultA = 'hit';
    }
  }
  // Heavy vs Strike
  else if (actionA === 'heavy_strike' && actionB === 'strike') {
    if (speedA - speedB > 10) {
      damageToB = heavyDmgA;
      resultA = 'hit';
      resultB = 'hit';
    } else {
      damageToB = heavyDmgA;
      damageToA = strikeDmgB;
      resultA = 'hit';
      resultB = 'hit';
    }
  } else if (actionB === 'heavy_strike' && actionA === 'strike') {
    if (speedB - speedA > 10) {
      damageToA = heavyDmgB;
      resultB = 'hit';
      resultA = 'hit';
    } else {
      damageToA = heavyDmgB;
      damageToB = strikeDmgA;
      resultA = 'hit';
      resultB = 'hit';
    }
  }
  // Heavy vs Block
  else if (actionA === 'heavy_strike' && actionB === 'block') {
    damageToB = blockPassthrough(heavyDmgA, true, lowStaminaB, zeroStaminaB);
    resultA = 'hit';
    resultB = 'blocked';
  } else if (actionB === 'heavy_strike' && actionA === 'block') {
    damageToA = blockPassthrough(heavyDmgB, true, lowStaminaA, zeroStaminaA);
    resultB = 'hit';
    resultA = 'blocked';
  }
  // Heavy vs Dodge
  else if (actionA === 'heavy_strike' && actionB === 'dodge') {
    if (enduranceB > 60 && canDodge(techniqueB, lowStaminaB, zeroStaminaB)) {
      resultA = 'miss';
      resultB = 'dodged';
    } else {
      damageToB = Math.round(heavyDmgA * 0.6);
      resultA = 'hit';
      resultB = 'hit';
    }
  } else if (actionB === 'heavy_strike' && actionA === 'dodge') {
    if (enduranceA > 60 && canDodge(techniqueA, lowStaminaA, zeroStaminaA)) {
      resultB = 'miss';
      resultA = 'dodged';
    } else {
      damageToA = Math.round(heavyDmgB * 0.6);
      resultB = 'hit';
      resultA = 'hit';
    }
  }
  // Heavy vs Heavy
  else if (actionA === 'heavy_strike' && actionB === 'heavy_strike') {
    if (speedA >= speedB) {
      damageToB = heavyDmgA;
      damageToA = Math.round(heavyDmgB * 0.5);
    } else {
      damageToA = heavyDmgB;
      damageToB = Math.round(heavyDmgA * 0.5);
    }
    resultA = 'hit';
    resultB = 'hit';
  }
  // Clinch vs any strike
  else if (actionA === 'clinch' && (actionB === 'strike' || actionB === 'heavy_strike')) {
    damageToA = 3;
    damageToB = 3;
    resultA = 'hit';
    resultB = 'hit';
  } else if (actionB === 'clinch' && (actionA === 'strike' || actionA === 'heavy_strike')) {
    damageToA = 3;
    damageToB = 3;
    resultA = 'hit';
    resultB = 'hit';
  }
  // Clinch vs Clinch
  else if (actionA === 'clinch' && actionB === 'clinch') {
    damageToA = 2;
    damageToB = 2;
    resultA = 'hit';
    resultB = 'hit';
  }
  // Block vs Block or Dodge vs Dodge — nothing happens
  else if ((actionA === 'block' && actionB === 'block') || (actionA === 'dodge' && actionB === 'dodge')) {
    resultA = 'miss';
    resultB = 'miss';
  }
  // Clinch vs Block/Dodge
  else if (actionA === 'clinch' && (actionB === 'block' || actionB === 'dodge')) {
    damageToB = 2;
    resultA = 'hit';
    resultB = 'miss';
  } else if (actionB === 'clinch' && (actionA === 'block' || actionA === 'dodge')) {
    damageToA = 2;
    resultB = 'hit';
    resultA = 'miss';
  }
  // Block vs Dodge or Dodge vs Block — nothing
  else {
    resultA = 'miss';
    resultB = 'miss';
  }

  return { damageToA, damageToB, resultA, resultB };
};

// ┌──────────────────────────────────────────┐
// │ Elo Calculation                          │
// └──────────────────────────────────────────┘

/**
 * Calculate Elo rating changes after a fight.
 *
 * @param ratingA - Gladiator A's current Elo.
 * @param ratingB - Gladiator B's current Elo.
 * @param aWins - Whether A won.
 * @returns Elo changes for A and B.
 */
const calculateElo = (ratingA: number, ratingB: number, aWins: boolean): { changeA: number; changeB: number } => {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  const scoreA = aWins ? 1 : 0;
  const scoreB = aWins ? 0 : 1;

  const changeA = Math.round(ELO_K_FACTOR * (scoreA - expectedA));
  const changeB = Math.round(ELO_K_FACTOR * (scoreB - expectedB));

  return { changeA, changeB };
};

// ┌──────────────────────────────────────────┐
// │ AI Decision                              │
// └──────────────────────────────────────────┘

/**
 * Get an AI decision for a gladiator.
 *
 * @param systemPrompt - System prompt for the gladiator.
 * @param context - Current fight context.
 * @returns Parsed action and reasoning.
 */
const getAIDecision = async (systemPrompt: string, context: string): Promise<AIDecision> => {
  const response = await claudeAdapter.chatCompletion(
    systemPrompt,
    [{ role: 'user', content: context }],
    'claude-sonnet-4-20250514',
    256,
  );

  try {
    const parsed = JSON.parse(response.text) as AIDecision;
    if (VALID_ACTIONS.includes(parsed.action)) {
      return parsed;
    }
  } catch {
    // Fall through to fallback
  }

  return { action: 'strike', reasoning: 'Failed to parse AI response, defaulting to strike.' };
};

// ┌──────────────────────────────────────────┐
// │ Main Simulation                          │
// └──────────────────────────────────────────┘

/**
 * Run a full fight simulation between two gladiators.
 * Both AI calls run in parallel per exchange. Fight completes server-side.
 *
 * @param gladiatorAId - Gladiator A ID.
 * @param gladiatorBId - Gladiator B ID.
 * @returns Fight ID.
 */
const simulateFightAction = async (gladiatorAId: string, gladiatorBId: string) =>
  tracer.trace('ACTION.FIGHT.SIMULATE', async () => {
    // 1. Load gladiators with stats and memories
    const [gladiatorA, gladiatorB] = await Promise.all([
      Data.gladiator.findById(gladiatorAId),
      Data.gladiator.findById(gladiatorBId),
    ]);

    if (!gladiatorA || !gladiatorB) throw Boom.notFound('One or both gladiators not found.');
    if (!gladiatorA.stats || !gladiatorB.stats) throw Boom.badRequest('Both gladiators must have stats.');

    const [memoriesA, memoriesB] = await Promise.all([
      Data.gladiatorMemory.findByGladiator(gladiatorAId),
      Data.gladiatorMemory.findByGladiator(gladiatorBId),
    ]);

    // 2. Create fight record
    const fight = await Data.fight.create({
      gladiator_a_id: gladiatorAId,
      gladiator_b_id: gladiatorBId,
    });

    await Data.fight.update(fight.id, { status: 'simulating' });

    // 3. Initialize state
    const stateA: GladiatorState = {
      id: gladiatorAId,
      name: gladiatorA.name,
      health: 100,
      stamina: 100,
      stats: gladiatorA.stats,
      memories: memoriesA,
      position: { x: -3, y: 0, z: 0 },
    };

    const stateB: GladiatorState = {
      id: gladiatorBId,
      name: gladiatorB.name,
      health: 100,
      stamina: 100,
      stats: gladiatorB.stats,
      memories: memoriesB,
      position: { x: 3, y: 0, z: 0 },
    };

    const systemPromptA = buildSystemPrompt(stateA);
    const systemPromptB = buildSystemPrompt(stateB);

    const events: FightEventRecord[] = [];
    const recentMovesA: string[] = [];
    const recentMovesB: string[] = [];

    // 4. Fight loop
    let exchange = 0;
    while (stateA.health > 0 && stateB.health > 0 && exchange < MAX_EXCHANGES) {
      exchange++;
      const timestampMs = exchange * EXCHANGE_INTERVAL_MS;

      // Regenerate stamina
      stateA.stamina = Math.min(100, stateA.stamina + Math.round(STAMINA_REGEN_PER_TICK * (1 + (stateA.stats.endurance - 50) / 100)));
      stateB.stamina = Math.min(100, stateB.stamina + Math.round(STAMINA_REGEN_PER_TICK * (1 + (stateB.stats.endurance - 50) / 100)));

      // Build context and get AI decisions IN PARALLEL
      const contextA = buildFightContext(stateA, stateB, recentMovesB.slice(-5), exchange, MAX_EXCHANGES);
      const contextB = buildFightContext(stateB, stateA, recentMovesA.slice(-5), exchange, MAX_EXCHANGES);

      const [decisionA, decisionB] = await Promise.all([
        getAIDecision(systemPromptA, contextA),
        getAIDecision(systemPromptB, contextB),
      ]);

      // Enforce stamina: if not enough, downgrade to strike
      let actionA = decisionA.action;
      let actionB = decisionB.action;

      if (stateA.stamina < STAMINA_COSTS[actionA]) actionA = 'strike';
      if (stateB.stamina < STAMINA_COSTS[actionB]) actionB = 'strike';
      if (stateA.stamina < STAMINA_COSTS.strike) actionA = 'block';
      if (stateB.stamina < STAMINA_COSTS.strike) actionB = 'block';

      // Deduct stamina
      stateA.stamina = Math.max(0, stateA.stamina - (STAMINA_COSTS[actionA] || 0));
      stateB.stamina = Math.max(0, stateB.stamina - (STAMINA_COSTS[actionB] || 0));

      // Resolve combat
      const { damageToA, damageToB, resultA, resultB } = resolveExchange(actionA, actionB, stateA, stateB);

      stateA.health = Math.max(0, stateA.health - damageToA);
      stateB.health = Math.max(0, stateB.health - damageToB);

      // Track recent moves
      recentMovesA.push(actionA);
      recentMovesB.push(actionB);

      // Record events for both gladiators
      events.push({
        fight_id: fight.id,
        timestamp_ms: timestampMs,
        actor_gladiator_id: gladiatorAId,
        action: actionA,
        result: resultA,
        damage_dealt: damageToB,
        stamina_cost: STAMINA_COSTS[actionA] || 0,
        health_after_actor: stateA.health,
        health_after_target: stateB.health,
        stamina_after_actor: stateA.stamina,
        stamina_after_target: stateB.stamina,
        ai_reasoning: decisionA.reasoning,
        position_actor: stateA.position,
        position_target: stateB.position,
      });

      events.push({
        fight_id: fight.id,
        timestamp_ms: timestampMs + 50,
        actor_gladiator_id: gladiatorBId,
        action: actionB,
        result: resultB,
        damage_dealt: damageToA,
        stamina_cost: STAMINA_COSTS[actionB] || 0,
        health_after_actor: stateB.health,
        health_after_target: stateA.health,
        stamina_after_actor: stateB.stamina,
        stamina_after_target: stateA.stamina,
        ai_reasoning: decisionB.reasoning,
        position_actor: stateB.position,
        position_target: stateA.position,
      });
    }

    // 5. Determine winner
    let winnerId: string | null = null;
    if (stateA.health <= 0 && stateB.health > 0) winnerId = gladiatorBId;
    else if (stateB.health <= 0 && stateA.health > 0) winnerId = gladiatorAId;
    else if (stateA.health > stateB.health) winnerId = gladiatorAId;
    else if (stateB.health > stateA.health) winnerId = gladiatorBId;
    // Tie: no winner

    // 6. Calculate Elo
    const { changeA, changeB } = winnerId
      ? calculateElo(gladiatorA.stats.elo_rating, gladiatorB.stats.elo_rating, winnerId === gladiatorAId)
      : { changeA: 0, changeB: 0 };

    // 7. Build self-contained replay data
    const replayData = {
      gladiator_a: {
        id: gladiatorAId,
        name: gladiatorA.name,
        stats: { ...gladiatorA.stats },
      },
      gladiator_b: {
        id: gladiatorBId,
        name: gladiatorB.name,
        stats: { ...gladiatorB.stats },
      },
      winner_id: winnerId,
      total_exchanges: exchange,
    };

    // 8. Save everything
    await Data.fightEvent.createMany(events);

    await Data.fight.update(fight.id, {
      winner_id: winnerId,
      duration_seconds: exchange,
      replay_data: replayData,
      elo_change_a: changeA,
      elo_change_b: changeB,
      status: 'completed',
    });

    // 9. Update gladiator stats
    const aWon = winnerId === gladiatorAId;
    const bWon = winnerId === gladiatorBId;

    await Promise.all([
      Data.gladiator.updateStats(gladiatorAId, {
        elo_rating: Math.max(0, gladiatorA.stats.elo_rating + changeA),
        wins: gladiatorA.stats.wins + (aWon ? 1 : 0),
        losses: gladiatorA.stats.losses + (bWon ? 1 : 0),
        experience_points: gladiatorA.stats.experience_points + exchange * 2 + (aWon ? 50 : 20),
      }),
      Data.gladiator.updateStats(gladiatorBId, {
        elo_rating: Math.max(0, gladiatorB.stats.elo_rating + changeB),
        wins: gladiatorB.stats.wins + (bWon ? 1 : 0),
        losses: gladiatorB.stats.losses + (aWon ? 1 : 0),
        experience_points: gladiatorB.stats.experience_points + exchange * 2 + (bWon ? 50 : 20),
      }),
    ]);

    return { fight_id: fight.id };
  });

export default simulateFightAction;
