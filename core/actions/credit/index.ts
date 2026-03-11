import Data from '../../data';
import { calculateGrokCredits, calculateElevenLabsCredits } from '../../constants/creditRates';

/**
 * Check if a user has enough credits for an estimated operation.
 * Returns true if they have credits remaining (or are admin).
 */
const hasCredits = async (userId: string, minimumCredits = 1): Promise<boolean> => {
  const user = await Data.user.findById(userId);
  if (!user) return false;
  return user.credit_balance >= minimumCredits;
};

/**
 * Deduct credits for a Grok API call and log usage.
 */
const chargeGrokUsage = async (
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  roomId?: string,
): Promise<{ credits: number; rawCostUsd: number; newBalance: number }> => {
  const { credits, rawCostUsd } = calculateGrokCredits(model, inputTokens, outputTokens);

  if (credits <= 0) return { credits: 0, rawCostUsd, newBalance: 0 };

  const user = await Data.user.findById(userId);
  if (!user) throw new Error('User not found');

  const updated = await Data.user.deductCredits(userId, credits);

  await Data.creditTransaction.create({
    user_id: userId,
    amount: -credits,
    balance_after: updated.credit_balance,
    type: 'usage',
    description: `Grok ${model} (${inputTokens}+${outputTokens} tokens)`,
  });

  await Data.creditUsageLog.create({
    user_id: userId,
    service: 'grok',
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    raw_cost_usd: rawCostUsd,
    credits_charged: credits,
    room_id: roomId,
  });

  return { credits, rawCostUsd, newBalance: updated.credit_balance };
};

/**
 * Deduct credits for an ElevenLabs TTS call and log usage.
 */
const chargeElevenLabsUsage = async (
  userId: string,
  characters: number,
): Promise<{ credits: number; rawCostUsd: number; newBalance: number }> => {
  const { credits, rawCostUsd } = calculateElevenLabsCredits(characters);

  if (credits <= 0) return { credits: 0, rawCostUsd, newBalance: 0 };

  const user = await Data.user.findById(userId);
  if (!user) throw new Error('User not found');

  const updated = await Data.user.deductCredits(userId, credits);

  await Data.creditTransaction.create({
    user_id: userId,
    amount: -credits,
    balance_after: updated.credit_balance,
    type: 'usage',
    description: `ElevenLabs TTS (${characters} chars)`,
  });

  await Data.creditUsageLog.create({
    user_id: userId,
    service: 'elevenlabs',
    characters,
    raw_cost_usd: rawCostUsd,
    credits_charged: credits,
  });

  return { credits, rawCostUsd, newBalance: updated.credit_balance };
};

/**
 * Grant credits from a top-up purchase.
 */
const grantTopUpCredits = async (
  userId: string,
  credits: number,
  referenceId?: string,
): Promise<{ credits: number; newBalance: number }> => {
  const updated = await Data.user.addCredits(userId, credits);

  await Data.creditTransaction.create({
    user_id: userId,
    amount: credits,
    balance_after: updated.credit_balance,
    type: 'topup',
    description: `Purchased ${credits} credits`,
    reference_id: referenceId,
  });

  return { credits, newBalance: updated.credit_balance };
};

/**
 * Get credit status for a user.
 */
const getCreditStatus = async (userId: string) => {
  const user = await Data.user.findById(userId);
  if (!user) throw new Error('User not found');

  return {
    balance: user.credit_balance,
  };
};

export default {
  hasCredits,
  chargeGrokUsage,
  chargeElevenLabsUsage,
  grantTopUpCredits,
  getCreditStatus,
};
