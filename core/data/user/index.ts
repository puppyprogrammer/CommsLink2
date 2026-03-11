import prisma from '../../adapters/prisma';

import type {
  CreateUserDTO,
  UpdateUserDTO,
  UpdatePremiumDTO,
  UserListItem,
} from '../../interfaces/user';
import type { user } from '../../../prisma/client';

/**
 * Create a new user.
 *
 * @param data - Username and hashed password.
 * @returns Created user record.
 */
const create = async (data: CreateUserDTO): Promise<user> =>
  prisma.user.create({ data });

/**
 * Find user by ID.
 *
 * @param id - User UUID.
 * @returns User or null.
 */
const findById = async (id: string): Promise<user | null> =>
  prisma.user.findUnique({ where: { id } });

/**
 * Find user by username.
 *
 * @param username - Unique username.
 * @returns User or null.
 */
const findByUsername = async (username: string): Promise<user | null> =>
  prisma.user.findUnique({ where: { username } });

/**
 * Find user by Stripe customer ID.
 *
 * @param stripeCustomerId - Stripe customer identifier.
 * @returns User or null.
 */
const findByStripeCustomerId = async (stripeCustomerId: string): Promise<user | null> =>
  prisma.user.findFirst({ where: { stripe_customer_id: stripeCustomerId } });

/**
 * Get all users for admin dashboard.
 *
 * @returns List of users without sensitive fields.
 */
const findAll = async (): Promise<UserListItem[]> =>
  prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      is_premium: true,
      is_banned: true,
      is_admin: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
  });

/**
 * Update user profile fields.
 *
 * @param id   - User UUID.
 * @param data - Fields to update.
 * @returns Updated user.
 */
const update = async (id: string, data: UpdateUserDTO): Promise<user> =>
  prisma.user.update({ where: { id }, data });

/**
 * Update premium and Stripe fields.
 *
 * @param id   - User UUID.
 * @param data - Premium status fields.
 * @returns Updated user.
 */
const updatePremium = async (id: string, data: UpdatePremiumDTO): Promise<user> =>
  prisma.user.update({ where: { id }, data });

/**
 * Toggle user ban status.
 *
 * @param id       - User UUID.
 * @param isBanned - New ban state.
 * @returns Updated user.
 */
const updateBanStatus = async (id: string, isBanned: boolean): Promise<user> =>
  prisma.user.update({ where: { id }, data: { is_banned: isBanned } });

/**
 * Deduct credits from user balance (atomic).
 *
 * @param id      - User UUID.
 * @param amount  - Credits to deduct (positive number).
 * @returns Updated user.
 */
const deductCredits = async (id: string, amount: number): Promise<user> =>
  prisma.user.update({
    where: { id },
    data: { credit_balance: { decrement: amount } },
  });

/**
 * Add credits to user balance (atomic).
 *
 * @param id     - User UUID.
 * @param amount - Credits to add (positive number).
 * @returns Updated user.
 */
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
  updatePremium,
  updateBanStatus,
  deductCredits,
  addCredits,
  updateLastRoom,
};
