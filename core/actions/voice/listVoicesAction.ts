import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';
import elevenlabsAdapter from '../../adapters/elevenlabs';

import type { ElevenLabsVoice } from '../../adapters/elevenlabs';

/**
 * List available premium voices.
 *
 * @param userId - Requesting user ID.
 * @returns Array of ElevenLabs voices.
 */
const listVoicesAction = async (userId: string): Promise<{ voices: ElevenLabsVoice[] }> =>
  tracer.trace('ACTION.VOICE.LIST', async () => {
    const user = await Data.user.findById(userId);

    if (!user) {
      throw Boom.notFound('User not found');
    }

    const voices = await elevenlabsAdapter.listVoices();
    return { voices };
  });

export default listVoicesAction;
