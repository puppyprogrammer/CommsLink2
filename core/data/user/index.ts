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
};
