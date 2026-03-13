import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

import type { thread } from '../../../prisma/client';

/**
 * Create a forum thread scoped to a room (AI agent command).
 *
 * @param roomId         - Room UUID where the thread is created.
 * @param title          - Thread title.
 * @param authorId       - Creator user ID (agent's creator).
 * @param authorUsername - Agent display name.
 * @returns Created thread record.
 */
const createAiThreadAction = async (
  roomId: string,
  title: string,
  authorId: string,
  authorUsername: string,
): Promise<thread> =>
  tracer.trace('ACTION.FORUM.CREATE_AI_THREAD', async () => {
    const room = await Data.room.findById(roomId);
    if (!room) throw Boom.notFound('Room not found');
    if (!room.cmd_forum_enabled) throw Boom.forbidden('Forum commands are disabled in this room');

    return Data.thread.create({
      title,
      author_id: authorId,
      author_username: authorUsername,
      room_id: roomId,
    });
  });

export default createAiThreadAction;
