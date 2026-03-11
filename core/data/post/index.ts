import prisma from '../../adapters/prisma';

import type { CreatePostDTO } from '../../interfaces/post';
import type { PaginationDTO } from '../../interfaces/thread';
import type { post } from '../../../prisma/client';

/**
 * Create a new forum post.
 *
 * @param data - Post creation fields.
 * @returns Created post.
 */
const create = async (data: CreatePostDTO): Promise<post> =>
  prisma.post.create({ data });

/**
 * Find post by ID.
 *
 * @param id - Post UUID.
 * @returns Post or null.
 */
const findById = async (id: string): Promise<post | null> =>
  prisma.post.findUnique({ where: { id } });

/**
 * Get posts for a thread, ordered chronologically.
 *
 * @param threadId   - Parent thread UUID.
 * @param pagination - Skip and take values.
 * @returns List of posts.
 */
const findByThreadId = async (threadId: string, pagination: PaginationDTO): Promise<post[]> =>
  prisma.post.findMany({
    where: { thread_id: threadId },
    skip: pagination.skip,
    take: pagination.take,
    orderBy: { created_at: 'asc' },
  });

/**
 * Delete a post by ID.
 *
 * @param id - Post UUID.
 */
const deleteById = async (id: string): Promise<void> => {
  await prisma.post.delete({ where: { id } });
};

export default { create, findById, findByThreadId, deleteById };
