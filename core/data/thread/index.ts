import prisma from '../../adapters/prisma';

import type { CreateThreadDTO, PaginationDTO } from '../../interfaces/thread';
import type { thread } from '../../../prisma/client';

/**
 * Create a new forum thread.
 *
 * @param data - Thread creation fields.
 * @returns Created thread.
 */
const create = async (data: CreateThreadDTO): Promise<thread> =>
  prisma.thread.create({ data });

/**
 * Find thread by ID.
 *
 * @param id - Thread UUID.
 * @returns Thread or null.
 */
const findById = async (id: string): Promise<thread | null> =>
  prisma.thread.findUnique({ where: { id } });

/**
 * Get paginated threads ordered by latest reply.
 *
 * @param pagination - Skip and take values.
 * @returns List of threads.
 */
const findAll = async (pagination: PaginationDTO): Promise<thread[]> =>
  prisma.thread.findMany({
    skip: pagination.skip,
    take: pagination.take,
    orderBy: { last_reply_at: 'desc' },
  });

/**
 * Increment view count.
 *
 * @param id - Thread UUID.
 */
const incrementViewCount = async (id: string): Promise<void> => {
  await prisma.thread.update({
    where: { id },
    data: { view_count: { increment: 1 } },
  });
};

/**
 * Increment reply count and update last reply timestamp.
 *
 * @param id - Thread UUID.
 */
const incrementReplyCount = async (id: string): Promise<void> => {
  await prisma.thread.update({
    where: { id },
    data: {
      reply_count: { increment: 1 },
      last_reply_at: new Date(),
    },
  });
};

/**
 * Decrement reply count.
 *
 * @param id - Thread UUID.
 */
const decrementReplyCount = async (id: string): Promise<void> => {
  await prisma.thread.update({
    where: { id },
    data: { reply_count: { decrement: 1 } },
  });
};

/**
 * Get paginated threads for a specific room, ordered by latest reply.
 *
 * @param roomId     - Room UUID.
 * @param pagination - Skip and take values.
 * @returns List of room-scoped threads.
 */
const findByRoomId = async (roomId: string, pagination: PaginationDTO): Promise<thread[]> =>
  prisma.thread.findMany({
    where: { room_id: roomId },
    skip: pagination.skip,
    take: pagination.take,
    orderBy: { last_reply_at: 'desc' },
  });

export default {
  create,
  findById,
  findAll,
  findByRoomId,
  incrementViewCount,
  incrementReplyCount,
  decrementReplyCount,
};
