import Boom from '@hapi/boom';

import Data from '../../data';
import elevenlabsAdapter from '../../adapters/elevenlabs';

/**
 * Generate TTS audio for an FFXIVoices user.
 *
 * @param userId - FFXIV user ID.
 * @param text - Text to synthesize.
 * @param voiceId - Optional override voice ID (defaults to user's saved voice).
 * @returns WAV audio buffer.
 */
const generateTTS = async (
  userId: string,
  text: string,
  voiceId?: string,
): Promise<Buffer> => {
  const user = await Data.ffxivUser.findById(userId);
  if (!user) {
    throw Boom.notFound('User not found');
  }

  if (user.credit_balance <= 0) {
    throw Boom.paymentRequired('Insufficient credits');
  }

  const selectedVoice = voiceId || user.voice_id;

  const wavBuffer = await elevenlabsAdapter.generateSpeechWav(text, selectedVoice);

  // Deduct credits: 1 credit per 50 characters, minimum 1
  const creditCost = Math.max(1, Math.ceil(text.length / 50));
  await Data.ffxivUser.deductCredits(user.id, creditCost);

  return wavBuffer;
};

export { generateTTS };
