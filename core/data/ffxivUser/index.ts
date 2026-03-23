import prisma from '../../adapters/prisma';
import type { ffxiv_user } from '../../../prisma/client';

const create = async (data: { username: string; password_hash: string; content_id?: string; char_name?: string }): Promise<ffxiv_user> =>
  prisma.ffxiv_user.create({ data });

const findByUsername = async (username: string): Promise<ffxiv_user | null> =>
  prisma.ffxiv_user.findUnique({ where: { username } });

const findById = async (id: string): Promise<ffxiv_user | null> =>
  prisma.ffxiv_user.findUnique({ where: { id } });

const update = async (id: string, data: Partial<{ char_name: string; content_id: string; voice_id: string }>): Promise<ffxiv_user> =>
  prisma.ffxiv_user.update({ where: { id }, data });

const deductCredits = async (id: string, amount: number): Promise<ffxiv_user> =>
  prisma.ffxiv_user.update({ where: { id }, data: { credit_balance: { decrement: amount } } });

export default { create, findByUsername, findById, update, deductCredits };
