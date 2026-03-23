import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';
import passwordHelper from '../../helpers/password';
import { VALID_BROWSER_VOICES } from '../../constants';

import type { UpdateUserDTO } from '../../interfaces/user';

type UpdateProfileInput = {
  userId: string;
  email?: string;
  password?: string;
  voice_id?: string;
  volume?: number;
  hear_own_voice?: boolean;
};

/**
 * Update user profile and preferences.
 *
 * @param input - Fields to update.
 * @returns Success indicator.
 */
const updateProfileAction = async (input: UpdateProfileInput): Promise<{ success: true }> =>
  tracer.trace('ACTION.PROFILE.UPDATE', async () => {
    const updates: UpdateUserDTO = {};

    if (input.email !== undefined) {
      if (!input.email.includes('@')) {
        throw Boom.badRequest('Invalid email address');
      }
      updates.email = input.email;
    }

    if (input.password !== undefined) {
      if (input.password.length < 6) {
        throw Boom.badRequest('Password must be at least 6 characters');
      }
      updates.password_hash = await passwordHelper.hashPassword(input.password);
    }

    if (input.voice_id !== undefined) {
      updates.voice_id = input.voice_id;
    }

    if (input.volume !== undefined) updates.volume = input.volume;
    if (input.hear_own_voice !== undefined) updates.hear_own_voice = input.hear_own_voice;

    if (Object.keys(updates).length === 0) {
      throw Boom.badRequest('No changes provided');
    }

    await Data.user.update(input.userId, updates);

    return { success: true as const };
  });

export default updateProfileAction;
