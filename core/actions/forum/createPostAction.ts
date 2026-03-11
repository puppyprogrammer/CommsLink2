import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

import type { CreatePostDTO } from '../../interfaces/post';

/**
 * Create a post in a forum thread.
 *
 * @param input - Post creation data.
 * @returns Created post ID.
 */
const createPostAction = async (input: CreatePostDTO): Promise<{ id: string }> =>
  tracer.trace('ACTION.FORUM.CREATE_POST', async () => {
    const thread = await Data.thread.findById(input.thread_id);

    if (!thread) {
      throw Boom.notFound('Thread not found');
    }

    const post = await Data.post.create(input);
    await Data.thread.incrementReplyCount(input.thread_id);

    return { id: post.id };
  });

export default createPostAction;
