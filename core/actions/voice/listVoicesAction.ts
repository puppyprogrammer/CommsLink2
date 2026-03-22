import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';
import pollyAdapter from '../../adapters/polly';

import type { PollyVoice } from '../../adapters/polly';

/**
 * List available premium voices.
 *
 * @param userId - Requesting user ID.
 * @returns Array of Polly voices.
 */
const listVoicesAction = async (userId: string): Promise<{ voices: PollyVoice[] }> =>
  tracer.trace('ACTION.VOICE.LIST', async () => {
    const user = await Data.user.findById(userId);

    if (!user) {
      throw Boom.notFound('User not found');
    }

    const voices = await pollyAdapter.listVoices();
    return { voices };
  });

export default listVoicesAction;
