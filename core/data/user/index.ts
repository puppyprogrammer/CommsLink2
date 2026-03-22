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

const deductCredits = async (id: string, amount: number): Promise<user> =>
  prisma.user.update({
    where: { id },
    data: { credit_balance: { decrement: amount } },
  });

const addCredits = async (id: string, amount: number): Promise<user> =>
  prisma.user.update({
    where: { id },
    data: { credit_balance: { increment: amount } },
  });

const updateLastRoom = async (id: string, roomId: string | null): Promise<user> =>
  prisma.user.update({ where: { id }, data: { last_room_id: roomId } });

/** Hard-delete a user and all associated data. */
const deleteAccount = async (id: string): Promise<void> => {
  await prisma.$transaction([
    prisma.credit_usage_log.deleteMany({ where: { user_id: id } }),
    prisma.credit_transaction.deleteMany({ where: { user_id: id } }),
    prisma.payment_transaction.deleteMany({ where: { user_id: id } }),
    prisma.machine_permission.deleteMany({ where: { machine: { owner_id: id } } }),
    prisma.machine.deleteMany({ where: { owner_id: id } }),
    prisma.claude_log.deleteMany({ where: { user_id: id } }),
    prisma.panel_log.deleteMany({ where: { user_id: id } }),
    prisma.memory_summary.deleteMany({ where: { room: { created_by: id } } }),
    prisma.llm_agent.deleteMany({ where: { creator_id: id } }),
    prisma.room_member.deleteMany({ where: { user_id: id } }),
    prisma.room_invite.deleteMany({ where: { created_by: id } }),
    prisma.message.deleteMany({ where: { author_id: id } }),
    prisma.room.deleteMany({ where: { created_by: id } }),
    prisma.user.delete({ where: { id } }),
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
};
