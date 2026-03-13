import prisma from "../../adapters/prisma";

/**
 * Create a new message record.
 *
 * @param data - Message fields.
 * @returns Created message.
 */
const create = async (data: {
  content: string;
  type: string;
  room_id: string;
  author_id?: string | null;
  username: string;
}) => {
  return prisma.message.create({ data });
};

/**
 * Find messages by room ID, ordered by creation time.
 *
 * @param roomId - Room UUID to fetch messages for.
 * @param limit  - Max messages to return.
 * @returns Array of messages.
 */
const findByRoom = async (roomId: string, limit = 50) => {
  return prisma.message.findMany({
    where: { room_id: roomId, summarized: false },
    orderBy: { created_at: "desc" },
    take: limit,
  });
};

/**
 * Find ALL messages by room (including summarized) for UI display.
 * This ensures chat history is never hidden from users.
 */
const findByRoomForUI = async (roomId: string, limit = 200) => {
  return prisma.message.findMany({
    where: { room_id: roomId },
    orderBy: { created_at: "desc" },
    take: limit,
  });
};

/**
 * Find messages by user, ordered by most recent.
 *
 * @param authorId - User ID.
 * @param limit    - Max messages to return.
 * @returns Array of messages.
 */
const findByUser = async (authorId: string, limit = 100) => {
  return prisma.message.findMany({
    where: { author_id: authorId },
    orderBy: { created_at: "desc" },
    take: limit,
  });
};

const countUnsummarized = async (roomId: string): Promise<number> =>
  prisma.message.count({ where: { room_id: roomId, summarized: false } });

const findUnsummarized = async (roomId: string, limit = 20) =>
  prisma.message.findMany({
    where: { room_id: roomId, summarized: false },
    orderBy: { created_at: "asc" },
    take: limit,
  });

const markSummarized = async (ids: string[]): Promise<void> => {
  await prisma.message.updateMany({
    where: { id: { in: ids } },
    data: { summarized: true },
  });
};

/**
 * Archive all messages in a room (mark as summarized).
 *
 * @param roomId - Room UUID.
 * @returns Number of archived messages.
 */
const archiveByRoom = async (roomId: string): Promise<number> => {
  const result = await prisma.message.updateMany({
    where: { room_id: roomId, summarized: false },
    data: { summarized: true },
  });
  return result.count;
};

export default {
  create,
  findByRoom,
  findByRoomForUI,
  findByUser,
  countUnsummarized,
  findUnsummarized,
  markSummarized,
  archiveByRoom,
};
