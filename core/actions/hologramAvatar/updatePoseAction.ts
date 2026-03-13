import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

import type { hologram_avatar } from '../../../prisma/client';

/**
 * Update the pose of a hologram avatar.
 *
 * @param avatarId - Avatar UUID.
 * @param userId   - Requesting user ID (ownership check).
 * @param pose     - New pose data (joint rotations).
 * @returns Updated avatar record.
 */
const updatePoseAction = async (avatarId: string, userId: string, pose: unknown): Promise<hologram_avatar> =>
  tracer.trace('ACTION.HOLOGRAM.UPDATE_POSE', async () => {
    const avatar = await Data.hologramAvatar.findById(avatarId);
    if (!avatar) {
      throw Boom.notFound('Avatar not found');
    }

    if (avatar.user_id !== userId) {
      throw Boom.forbidden('Not authorized to update this avatar');
    }

    return Data.hologramAvatar.updatePose(avatarId, pose);
  });

export default updatePoseAction;
