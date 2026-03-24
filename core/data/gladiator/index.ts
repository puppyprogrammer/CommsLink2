import prisma from '../../adapters/prisma';

import type { gladiator, gladiator_stats } from '../../../prisma/client';

type CreateGladiatorDTO = {
  user_id: string;
  name: string;
  avatar_config?: Record<string, unknown>;
};

type UpdateGladiatorDTO = {
  name?: string;
  avatar_config?: Record<string, unknown>;
  is_active?: boolean;
};

type GladiatorWithStats = gladiator & {
  stats: gladiator_stats | null;
};

/**
 * Create a gladiator with default stats.
 *
 * @param data - Gladiator creation data.
 * @returns Created gladiator with stats.
 */
const create = async (data: CreateGladiatorDTO): Promise<GladiatorWithStats> => {
  const gladiator = await prisma.gladiator.create({
    data: {
      ...data,
      stats: {
        create: {
          strength: 50,
          speed: 50,
          endurance: 50,
          technique: 50,
        },
      },
    },
    include: { stats: true },
  });
  return gladiator;
};

/**
 * Find a gladiator by ID with stats.
 *
 * @param id - Gladiator ID.
 * @returns Gladiator with stats or null.
 */
const findById = async (id: string): Promise<GladiatorWithStats | null> =>
  prisma.gladiator.findUnique({
    where: { id },
    include: { stats: true },
  });

/**
 * Find all gladiators belonging to a user.
 *
 * @param userId - User ID.
 * @returns Array of gladiators with stats.
 */
const findByUser = async (userId: string): Promise<GladiatorWithStats[]> =>
  prisma.gladiator.findMany({
    where: { user_id: userId },
    include: { stats: true },
    orderBy: { created_at: 'desc' },
  });

/**
 * Update a gladiator.
 *
 * @param id - Gladiator ID.
 * @param data - Fields to update.
 * @returns Updated gladiator.
 */
const update = async (id: string, data: UpdateGladiatorDTO): Promise<gladiator> =>
  prisma.gladiator.update({ where: { id }, data });

/**
 * Update gladiator stats (e.g., after a fight).
 *
 * @param gladiatorId - Gladiator ID.
 * @param data - Stats fields to update.
 * @returns Updated stats.
 */
const updateStats = async (
  gladiatorId: string,
  data: Partial<Omit<gladiator_stats, 'gladiator_id'>>,
): Promise<gladiator_stats> =>
  prisma.gladiator_stats.update({
    where: { gladiator_id: gladiatorId },
    data,
  });

/**
 * Get the global leaderboard sorted by Elo rating.
 *
 * @param limit - Max results.
 * @returns Gladiators with stats ordered by rating descending.
 */
const leaderboard = async (limit: number = 50): Promise<GladiatorWithStats[]> =>
  prisma.gladiator.findMany({
    where: { is_active: true },
    include: { stats: true },
    orderBy: { stats: { elo_rating: 'desc' } },
    take: limit,
  });

/**
 * Delete a gladiator and all related data.
 *
 * @param id - Gladiator ID.
 * @returns Deleted gladiator.
 */
const remove = async (id: string): Promise<gladiator> =>
  prisma.gladiator.delete({ where: { id } });

export default { create, findById, findByUser, update, updateStats, leaderboard, remove };
