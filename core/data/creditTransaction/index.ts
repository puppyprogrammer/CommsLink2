import prisma from '../../adapters/prisma';

import type { credit_transaction } from '../../../prisma/client';

type CreateTransactionDTO = {
  user_id: string;
  amount: number;
  balance_after: number;
  type: string;
  description?: string;
  reference_id?: string;
};

const create = async (data: CreateTransactionDTO): Promise<credit_transaction> =>
  prisma.credit_transaction.create({ data });

const findByUser = async (
  userId: string,
  limit = 50,
): Promise<credit_transaction[]> =>
  prisma.credit_transaction.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

export type { CreateTransactionDTO };
export default { create, findByUser };
