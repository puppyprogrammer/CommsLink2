import prisma from '../../adapters/prisma';

import type { credit_usage_log } from '../../../prisma/client';

type CreateUsageLogDTO = {
  user_id: string;
  service: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  characters?: number;
  raw_cost_usd: number;
  credits_charged: number;
  room_id?: string;
};

const create = async (data: CreateUsageLogDTO): Promise<credit_usage_log> =>
  prisma.credit_usage_log.create({ data });

const findByUser = async (
  userId: string,
  limit = 50,
): Promise<credit_usage_log[]> =>
  prisma.credit_usage_log.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

const sumByUserSince = async (
  userId: string,
  since: Date,
): Promise<number> => {
  const result = await prisma.credit_usage_log.aggregate({
    where: { user_id: userId, created_at: { gte: since } },
    _sum: { credits_charged: true },
  });
  return result._sum.credits_charged || 0;
};

export type { CreateUsageLogDTO };
export default { create, findByUser, sumByUserSince };
