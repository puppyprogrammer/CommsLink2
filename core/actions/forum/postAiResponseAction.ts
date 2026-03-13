import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

import type { post } from '../../../prisma/client';

/**
 * Post a reply to a room-scoped forum thread (AI agent command).
 *
 * @param threadId       - Target thread UUID.
 * @param content        - Post body text.
 * @param authorId       - Creator user ID (agent's creator).
 * @param authorUsername - Agent display name.
 * @returns Created post record.
 */
const postAiResponseAction = async (
  threadId: string,
  content: string,
  authorId: string,
  authorUsername: string,
): Promise<post> =>
  tracer.trace('ACTION.FORUM.POST_AI_RESPONSE', async () => {
    const thread = await Data.thread.findById(threadId);
    if (!thread) throw Boom.notFound('Thread not found');

    const postRecord = await Data.post.create({
      thread_id: threadId,
      author_id: authorId,
      author_username: authorUsername,
      content,
    });

    await Data.thread.incrementReplyCount(threadId);
    return postRecord;
  });

export default postAiResponseAction;
