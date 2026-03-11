import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

/**
 * Delete a forum post (ownership required).
 *
 * @param postId           - Post UUID to delete.
 * @param requestingUserId - ID of user requesting deletion.
 * @returns Success indicator.
 */
const deletePostAction = async (
  postId: string,
  requestingUserId: string,
): Promise<{ success: true }> =>
  tracer.trace('ACTION.FORUM.DELETE_POST', async () => {
    const post = await Data.post.findById(postId);

    if (!post) {
      throw Boom.notFound('Post not found');
    }

    if (post.author_id !== requestingUserId) {
      throw Boom.forbidden('Not authorized to delete this post');
    }

    await Data.post.deleteById(postId);
    await Data.thread.decrementReplyCount(post.thread_id);

    return { success: true as const };
  });

export default deletePostAction;
