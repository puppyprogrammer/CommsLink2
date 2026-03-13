import tracer from '../../lib/tracer';

import Data from '../../data';

import type { hologram_avatar } from '../../../prisma/client';

/**
 * Load all hologram avatars for a room.
 *
 * @param roomId - Room UUID.
 * @returns Array of hologram avatar records.
 */
const loadAvatarsAction = async (roomId: string): Promise<hologram_avatar[]> =>
  tracer.trace('ACTION.HOLOGRAM.LOAD', async () => {
    return Data.hologramAvatar.findByRoom(roomId);
  });

export default loadAvatarsAction;
