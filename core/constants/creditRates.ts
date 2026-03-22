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
 * Amazon Polly pricing: $4.00 per 1M characters (neural voices).
 */
const POLLY_COST_PER_CHAR = 4.0 / 1_000_000;

const calculatePollyCredits = (
  characters: number,
): { credits: number; rawCostUsd: number } => {
  const rawCostUsd = characters * POLLY_COST_PER_CHAR;
  return { credits: usdToCredits(rawCostUsd), rawCostUsd };
};

/**
 * EC2 instance cost tracking.
 * t3.medium ~$0.0416 USD/hour, split across connected users in a room.
 */
const EC2_COST_HOUR_USD = 0.0416;
const EC2_COST_PER_SECOND_USD = EC2_COST_HOUR_USD / 3600;
const EC2_COST_PER_SECOND_CREDITS = Math.ceil(EC2_COST_PER_SECOND_USD * 1000 * MARGIN); // ~0.0173 credits/sec per user

/** Billing interval in seconds for EC2 usage charges. */
const EC2_BILLING_INTERVAL_SECONDS = 60;

/**
 * Calculate credit cost for EC2 usage over a duration.
 *
 * @param durationSeconds - Time spent in a premium room.
 * @returns Credits to charge and raw USD cost.
 */
const calculateEC2Credits = (
  durationSeconds: number,
): { credits: number; rawCostUsd: number } => {
  const rawCostUsd = durationSeconds * EC2_COST_PER_SECOND_USD;
  return { credits: usdToCredits(rawCostUsd), rawCostUsd };
};

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
  EC2_COST_HOUR_USD,
  EC2_COST_PER_SECOND_USD,
  EC2_COST_PER_SECOND_CREDITS,
  EC2_BILLING_INTERVAL_SECONDS,
  CREDIT_PACKS,
  usdToCredits,
  calculateGrokCredits,
  calculatePollyCredits,
  calculateEC2Credits,
};
