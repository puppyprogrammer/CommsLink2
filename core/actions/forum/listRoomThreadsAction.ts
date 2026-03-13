import tracer from '../../lib/tracer';

import Data from '../../data';

import type { thread } from '../../../prisma/client';

/**
 * List forum threads scoped to a room.
 *
 * @param roomId - Room UUID.
 * @param page   - Page number (1-based).
 * @param limit  - Items per page.
 * @returns Paginated thread list.
 */
const listRoomThreadsAction = async (
  roomId: string,
  page: number = 1,
  limit: number = 20,
): Promise<thread[]> =>
  tracer.trace('ACTION.FORUM.LIST_ROOM_THREADS', async () =>
    Data.thread.findByRoomId(roomId, {
      skip: (page - 1) * limit,
      take: limit,
    }),
  );

export default listRoomThreadsAction;
