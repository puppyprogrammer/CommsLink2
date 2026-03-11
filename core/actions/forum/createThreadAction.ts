import tracer from '../../lib/tracer';

import Data from '../../data';

import type { CreateThreadDTO } from '../../interfaces/thread';

/**
 * Create a new forum thread.
 *
 * @param input - Thread creation data.
 * @returns Created thread ID.
 */
const createThreadAction = async (input: CreateThreadDTO): Promise<{ id: string }> =>
  tracer.trace('ACTION.FORUM.CREATE_THREAD', async () => {
    const thread = await Data.thread.create(input);
    return { id: thread.id };
  });

export default createThreadAction;
