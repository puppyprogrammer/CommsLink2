import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';
import pollyAdapter from '../../adapters/polly';
import comprehendAdapter from '../../adapters/comprehend';
import creditActions from '../credit';

import type { SpeechResult } from '../../adapters/polly';

/**
 * Generate premium TTS audio for a user.
 *
 * @param userId  - Requesting user ID.
 * @param text    - Text to synthesize.
 * @param voiceId - Polly voice ID (e.g. "Joanna").
 * @returns Base64 audio.
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

    const hasCredits = await creditActions.hasCredits(userId);
    if (!hasCredits) {
      throw Boom.paymentRequired('Insufficient credits for voice generation');
    }

    // Detect sentiment for emotion-aware TTS, fall back to plain on failure
    let sentiment;
    try {
      sentiment = await comprehendAdapter.detectSentiment(text);
    } catch (sentimentErr) {
      console.error('[Voice] Comprehend sentiment detection failed, using plain TTS:', sentimentErr);
    }

    const result = await pollyAdapter.generateSpeechWithEmotion(text, voiceId, sentiment);

    creditActions.chargePollyUsage(userId, text.length).catch(console.error);

    return result;
  });

export default generatePremiumAudioAction;
