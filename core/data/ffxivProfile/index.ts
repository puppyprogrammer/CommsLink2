import prisma from '../../adapters/prisma';
import type { ffxiv_profile } from '../../../prisma/client';

const create = async (data: {
  user_id: string;
  content_id?: string;
  char_name?: string;
  voice_id?: string;
  registration_ip?: string;
}): Promise<ffxiv_profile> =>
  prisma.ffxiv_profile.create({ data });

const findByUserId = async (userId: string): Promise<ffxiv_profile | null> =>
  prisma.ffxiv_profile.findUnique({ where: { user_id: userId } });

const update = async (userId: string, data: Partial<{
  content_id: string;
  char_name: string;
  voice_id: string;
}>): Promise<ffxiv_profile> =>
  prisma.ffxiv_profile.update({ where: { user_id: userId }, data });

/** Count users from this IP that received free credits this month */
const countFreeCreditsThisMonth = async (ip: string): Promise<number> => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return prisma.user.count({
    where: {
      ffxiv_profile: { registration_ip: ip },
      last_free_credit_at: { gte: monthStart },
    },
  });
};

export default { create, findByUserId, update, countFreeCreditsThisMonth };
