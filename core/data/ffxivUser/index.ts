import prisma from '../../adapters/prisma';
import type { ffxiv_user } from '../../../prisma/client';

const create = async (data: {
  username: string;
  password_hash: string;
  content_id?: string;
  char_name?: string;
  registration_ip?: string;
}): Promise<ffxiv_user> =>
  prisma.ffxiv_user.create({ data });

const findByUsername = async (username: string): Promise<ffxiv_user | null> =>
  prisma.ffxiv_user.findUnique({ where: { username } });

const findById = async (id: string): Promise<ffxiv_user | null> =>
  prisma.ffxiv_user.findUnique({ where: { id } });

const update = async (id: string, data: Partial<{
  char_name: string;
  content_id: string;
  voice_id: string;
  last_free_credit_at: Date;
}>): Promise<ffxiv_user> =>
  prisma.ffxiv_user.update({ where: { id }, data });

const deductCredits = async (id: string, amount: number): Promise<ffxiv_user> =>
  prisma.ffxiv_user.update({ where: { id }, data: { credit_balance: { decrement: amount } } });

const addCredits = async (id: string, amount: number): Promise<ffxiv_user> =>
  prisma.ffxiv_user.update({ where: { id }, data: { credit_balance: { increment: amount } } });

/** Find users registered from a given IP that received free credits this month */
const countFreeCreditsThisMonth = async (ip: string): Promise<number> => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return prisma.ffxiv_user.count({
    where: {
      registration_ip: ip,
      last_free_credit_at: { gte: monthStart },
    },
  });
};

export default { create, findByUsername, findById, update, deductCredits, addCredits, countFreeCreditsThisMonth };
