import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';
import elevenlabsAdapter from '../../adapters/elevenlabs';
import creditActions from '../credit';

import type { SpeechResult } from '../../adapters/elevenlabs';

/**
 * Generate premium TTS audio for a user.
 *
 * @param userId  - Requesting user ID.
 * @param text    - Text to synthesize.
 * @param voiceId - ElevenLabs voice ID.
 * @returns Base64 audio and alignment.
 */
const generatePremiumAudioAction = async (
  userId: string,
  text: string,
  voiceId: string,
): Promise<SpeechResult> =>
  tracer.trace('ACTION.VOICE.GENERATE', async () => {
    const user = await Data.user.findById(userId);

    if (!user) {
      throw Boom.notFound('User not found');
    }

    if (!user.is_premium) {
      throw Boom.forbidden('Premium subscription required');
    }

    // Check credits before generating
    const hasCredits = await creditActions.hasCredits(userId);
    if (!hasCredits) {
      throw Boom.paymentRequired('Insufficient credits for voice generation');
    }

    const result = await elevenlabsAdapter.generateSpeech(text, voiceId);

    // Charge credits based on character count
    creditActions.chargeElevenLabsUsage(userId, text.length).catch(console.error);

    return result;
  });

export default generatePremiumAudioAction;
