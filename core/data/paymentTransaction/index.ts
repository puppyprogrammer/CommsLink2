import prisma from '../../adapters/prisma';

import type { payment_transaction } from '../../../prisma/client';

type CreatePaymentTransactionDTO = {
  user_id: string;
  stripe_session_id: string;
  stripe_payment_intent_id?: string;
  amount_usd: number;
  currency?: string;
  status: string;
  pack_id?: string;
  credits_granted: number;
};

/**
 * Create a payment transaction record.
 *
 * @param data - Payment transaction fields.
 * @returns Created record.
 */
const create = async (data: CreatePaymentTransactionDTO): Promise<payment_transaction> =>
  prisma.payment_transaction.create({ data });

/**
 * Find payment transactions for a user.
 *
 * @param userId - User UUID.
 * @param limit  - Max records to return.
 * @returns Payment transactions ordered by newest first.
 */
const findByUser = async (
  userId: string,
  limit = 50,
): Promise<payment_transaction[]> =>
  prisma.payment_transaction.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

/**
 * Find a payment transaction by Stripe session ID.
 *
 * @param sessionId - Stripe checkout session ID.
 * @returns Payment transaction or null.
 */
const findByStripeSessionId = async (
  sessionId: string,
): Promise<payment_transaction | null> =>
  prisma.payment_transaction.findUnique({
    where: { stripe_session_id: sessionId },
  });

/**
 * Update payment transaction status.
 *
 * @param id     - Record UUID.
 * @param status - New status string.
 * @returns Updated record.
 */
const updateStatus = async (
  id: string,
  status: string,
): Promise<payment_transaction> =>
  prisma.payment_transaction.update({
    where: { id },
    data: { status },
  });

export type { CreatePaymentTransactionDTO };
export default { create, findByUser, findByStripeSessionId, updateStatus };
