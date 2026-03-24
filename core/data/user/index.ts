import prisma from '../../adapters/prisma';

import type {
  CreateUserDTO,
  UpdateUserDTO,
  UserListItem,
} from '../../interfaces/user';
import type { user } from '../../../prisma/client';

const create = async (data: CreateUserDTO): Promise<user> =>
  prisma.user.create({ data });

const findById = async (id: string): Promise<user | null> =>
  prisma.user.findUnique({ where: { id } });

const findByUsername = async (username: string): Promise<user | null> =>
  prisma.user.findUnique({ where: { username } });

const findByStripeCustomerId = async (stripeCustomerId: string): Promise<user | null> =>
  prisma.user.findFirst({ where: { stripe_customer_id: stripeCustomerId } });

const findAll = async (): Promise<UserListItem[]> =>
  prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      is_banned: true,
      is_admin: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
  });

const update = async (id: string, data: UpdateUserDTO): Promise<user> =>
  prisma.user.update({ where: { id }, data });

const updateBanStatus = async (id: string, isBanned: boolean): Promise<user> =>
  prisma.user.update({ where: { id }, data: { is_banned: isBanned } });

/**
 * Atomically deduct credits, ensuring balance doesn't go below zero.
 * Uses a WHERE clause so the update only succeeds if sufficient balance exists.
 * Throws if insufficient credits.
 */
const deductCredits = async (id: string, amount: number): Promise<user> => {
  const result = await prisma.user.updateMany({
    where: { id, credit_balance: { gte: amount } },
    data: { credit_balance: { decrement: amount } },
  });
  if (result.count === 0) {
    throw new Error('Insufficient credits');
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new Error('User not found');
  return user;
};

const addCredits = async (id: string, amount: number): Promise<user> =>
  prisma.user.update({
    where: { id },
    data: { credit_balance: { increment: amount } },
  });

const updateLastRoom = async (id: string, roomId: string | null): Promise<user> =>
  prisma.user.update({ where: { id }, data: { last_room_id: roomId } });

/** Hard-delete a user and all associated data. */
const deleteAccount = async (id: string): Promise<void> => {
  // Look up username for claude_log cleanup
  const user = await prisma.user.findUnique({ where: { id } });
  const username = user?.username || '';

  // Get rooms created by this user for panel_log and memory cleanup
  const ownedRooms = await prisma.room.findMany({ where: { created_by: id }, select: { id: true } });
  const ownedRoomIds = ownedRooms.map((r) => r.id);

  await prisma.$transaction([
    prisma.credit_usage_log.deleteMany({ where: { user_id: id } }),
    prisma.credit_transaction.deleteMany({ where: { user_id: id } }),
    prisma.payment_transaction.deleteMany({ where: { user_id: id } }),
    prisma.machine_permission.deleteMany({ where: { machine: { owner_id: id } } }),
    prisma.machine.deleteMany({ where: { owner_id: id } }),
    ...(username ? [prisma.claude_log.deleteMany({ where: { username } })] : []),
    ...(ownedRoomIds.length > 0 ? [prisma.panel_log.deleteMany({ where: { room_id: { in: ownedRoomIds } } })] : []),
    ...(ownedRoomIds.length > 0 ? [prisma.memory_summary.deleteMany({ where: { room_id: { in: ownedRoomIds } } })] : []),
    prisma.llm_agent.deleteMany({ where: { creator_id: id } }),
    prisma.room_member.deleteMany({ where: { user_id: id } }),
    prisma.room_invite.deleteMany({ where: { created_by: id } }),
    prisma.message.deleteMany({ where: { author_id: id } }),
    prisma.room.deleteMany({ where: { created_by: id } }),
    prisma.user.delete({ where: { id } }),
  ]);
};

/** Clear user-created content but keep account and financial records. */
const clearUserData = async (id: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id } });
  const username = user?.username || '';

  const ownedRooms = await prisma.room.findMany({ where: { created_by: id }, select: { id: true } });
  const ownedRoomIds = ownedRooms.map((r) => r.id);

  await prisma.$transaction([
    // User-created content
    prisma.message.deleteMany({ where: { author_id: id } }),
    prisma.machine_permission.deleteMany({ where: { machine: { owner_id: id } } }),
    prisma.machine.deleteMany({ where: { owner_id: id } }),
    prisma.llm_agent.deleteMany({ where: { creator_id: id } }),
    prisma.room_member.deleteMany({ where: { user_id: id } }),
    prisma.room_invite.deleteMany({ where: { created_by: id } }),
    ...(username ? [prisma.claude_log.deleteMany({ where: { username } })] : []),
    ...(ownedRoomIds.length > 0 ? [
      prisma.panel_log.deleteMany({ where: { room_id: { in: ownedRoomIds } } }),
      prisma.memory_summary.deleteMany({ where: { room_id: { in: ownedRoomIds } } }),
    ] : []),
    prisma.room.deleteMany({ where: { created_by: id } }),
    // Keep: credit_transaction, credit_usage_log, payment_transaction (financial records)
  ]);
};

export default {
  create,
  findById,
  findByUsername,
  findByStripeCustomerId,
  findAll,
  update,
  updateBanStatus,
  deductCredits,
  addCredits,
  updateLastRoom,
  deleteAccount,
  clearUserData,
};
