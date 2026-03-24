import prisma from '../../adapters/prisma';

import type { Prisma } from '../../../prisma/client';
import type { fight } from '../../../prisma/client';

type CreateFightDTO = {
  gladiator_a_id: string;
  gladiator_b_id: string;
  is_ranked?: boolean;
};

type UpdateFightDTO = {
  winner_id?: string | null;
  duration_seconds?: number;
  replay_data?: Prisma.InputJsonValue;
  elo_change_a?: number;
  elo_change_b?: number;
  status?: string;
};

/**
 * Create a new fight record.
 *
 * @param data - Fight creation data.
 * @returns Created fight.
 */
const create = async (data: CreateFightDTO): Promise<fight> =>
  prisma.fight.create({ data });

/**
 * Find a fight by ID.
 *
 * @param id - Fight ID.
 * @returns Fight or null.
 */
const findById = async (id: string): Promise<fight | null> =>
  prisma.fight.findUnique({ where: { id } });

/**
 * Find a fight by ID with full gladiator data and stats.
 *
 * @param id - Fight ID.
 * @returns Fight with related data.
 */
const findByIdWithDetails = async (id: string) =>
  prisma.fight.findUnique({
    where: { id },
    include: {
      gladiator_a: { include: { stats: true } },
      gladiator_b: { include: { stats: true } },
      winner: true,
    },
  });

/**
 * Find fights involving a specific gladiator.
 *
 * @param gladiatorId - Gladiator ID.
 * @param limit - Max results.
 * @returns Recent fights.
 */
const findByGladiator = async (gladiatorId: string, limit: number = 20): Promise<fight[]> =>
  prisma.fight.findMany({
    where: {
      OR: [
        { gladiator_a_id: gladiatorId },
        { gladiator_b_id: gladiatorId },
      ],
      status: 'completed',
    },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

/**
 * Update a fight record.
 *
 * @param id - Fight ID.
 * @param data - Fields to update.
 * @returns Updated fight.
 */
const update = async (id: string, data: UpdateFightDTO): Promise<fight> =>
  prisma.fight.update({ where: { id }, data });

export default { create, findById, findByIdWithDetails, findByGladiator, update };
