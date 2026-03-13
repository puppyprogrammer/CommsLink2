import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

import type { hologram_avatar } from '../../../prisma/client';

type CreateAvatarInput = {
  roomId: string;
  userId: string;
  label: string;
  skeleton: unknown;
  points: unknown;
  physics?: boolean;
};

/**
 * Create or replace a hologram avatar for a user in a room.
 *
 * @param input - Avatar creation payload.
 * @returns Created hologram avatar record.
 */
const createAvatarAction = async (input: CreateAvatarInput): Promise<hologram_avatar> =>
  tracer.trace('ACTION.HOLOGRAM.CREATE', async () => {
    const { roomId, userId, label, skeleton, points, physics } = input;

    const room = await Data.room.findById(roomId);
    if (!room) {
      throw Boom.notFound('Room not found');
    }

    // Remove existing avatar for this user in this room (upsert behavior)
    const existing = await Data.hologramAvatar.findByRoomAndUser(roomId, userId);
    if (existing) {
      await Data.hologramAvatar.remove(existing.id);
    }

    return Data.hologramAvatar.create({
      room_id: roomId,
      user_id: userId,
      label,
      skeleton,
      points,
      physics: physics ?? true,
    });
  });

export default createAvatarAction;
