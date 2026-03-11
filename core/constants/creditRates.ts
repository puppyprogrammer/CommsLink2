/**
 * Credit system constants.
 *
 * 1 credit = $0.001 of API cost.
 * All prices include a 1.5x margin over raw API cost.
 */

/** Margin multiplier applied to raw API cost. */
const MARGIN = 1.5;

/** Convert raw USD cost to credits (1 credit = $0.001). */
const usdToCredits = (usd: number): number => Math.ceil(usd * 1000 * MARGIN);

/**
 * Grok model pricing per million tokens (input / output).
 * Used to calculate per-call credit cost.
 */
const GROK_PRICING: Record<string, { input: number; output: number }> = {
  'grok-4-1-fast-reasoning': { input: 0.20, output: 0.50 },
  'grok-4-1-fast-non-reasoning': { input: 0.20, output: 0.50 },
  'grok-4-fast-reasoning': { input: 0.20, output: 0.50 },
  'grok-4-fast-non-reasoning': { input: 0.20, output: 0.50 },
  'grok-4-0709': { input: 3.00, output: 15.00 },
  'grok-3': { input: 3.00, output: 15.00 },
  'grok-3-mini': { input: 0.30, output: 0.50 },
  'grok-code-fast-1': { input: 0.20, output: 1.50 },
};

/**
 * Calculate credit cost for a Grok API call.
 *
 * @param model        - Grok model ID.
 * @param inputTokens  - Number of input tokens used.
 * @param outputTokens - Number of output tokens used.
 * @returns Credits to charge.
 */
const calculateGrokCredits = (
  model: string,
  inputTokens: number,
  outputTokens: number,
): { credits: number; rawCostUsd: number } => {
  const pricing = GROK_PRICING[model] || GROK_PRICING['grok-4-1-fast-non-reasoning'];
  const rawCostUsd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return { credits: usdToCredits(rawCostUsd), rawCostUsd };
};

/**
 * ElevenLabs pricing: ~$0.30 per 1000 characters (Creator tier estimate).
 */
const ELEVENLABS_COST_PER_CHAR = 0.30 / 1000;

const calculateElevenLabsCredits = (
  characters: number,
): { credits: number; rawCostUsd: number } => {
  const rawCostUsd = characters * ELEVENLABS_COST_PER_CHAR;
  return { credits: usdToCredits(rawCostUsd), rawCostUsd };
};

/**
 * Monthly subscription: $9.99 for 750 credits.
 */
const SUBSCRIPTION = {
  priceUsd: 9.99,
  monthlyCredits: 750,
} as const;

/**
 * Credit top-up packs (one-time purchases).
 */
const CREDIT_PACKS = [
  { id: 'pack_100', credits: 100, priceUsd: 1.99 },
  { id: 'pack_500', credits: 500, priceUsd: 7.99 },
  { id: 'pack_1500', credits: 1500, priceUsd: 19.99 },
] as const;

export {
  MARGIN,
  GROK_PRICING,
  ELEVENLABS_COST_PER_CHAR,
  SUBSCRIPTION,
  CREDIT_PACKS,
  usdToCredits,
  calculateGrokCredits,
  calculateElevenLabsCredits,
};
