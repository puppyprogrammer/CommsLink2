import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

/**
 * Remove a hologram avatar from a room.
 *
 * @param avatarId - Avatar UUID.
 * @param userId   - Requesting user ID (ownership check).
 * @returns Success indicator.
 */
const removeAvatarAction = async (avatarId: string, userId: string): Promise<{ success: true }> =>
  tracer.trace('ACTION.HOLOGRAM.REMOVE', async () => {
    const avatar = await Data.hologramAvatar.findById(avatarId);
    if (!avatar) {
      throw Boom.notFound('Avatar not found');
    }

    if (avatar.user_id !== userId) {
      throw Boom.forbidden('Not authorized to remove this avatar');
    }

    await Data.hologramAvatar.remove(avatarId);

    return { success: true as const };
  });

export default removeAvatarAction;
