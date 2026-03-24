import prisma from '../../adapters/prisma';

import type { gladiator_memory } from '../../../prisma/client';

type CreateMemoryDTO = {
  gladiator_id: string;
  memory_type: string;
  content: string;
  priority?: number;
};

/**
 * Add a memory to a gladiator.
 *
 * @param data - Memory creation data.
 * @returns Created memory.
 */
const create = async (data: CreateMemoryDTO): Promise<gladiator_memory> =>
  prisma.gladiator_memory.create({ data });

/**
 * Find all active memories for a gladiator.
 *
 * @param gladiatorId - Gladiator ID.
 * @returns Active memories sorted by priority descending.
 */
const findByGladiator = async (gladiatorId: string): Promise<gladiator_memory[]> =>
  prisma.gladiator_memory.findMany({
    where: { gladiator_id: gladiatorId, is_active: true },
    orderBy: { priority: 'desc' },
  });

/**
 * Find memories by type for a gladiator.
 *
 * @param gladiatorId - Gladiator ID.
 * @param memoryType - Memory type filter.
 * @returns Filtered memories.
 */
const findByType = async (gladiatorId: string, memoryType: string): Promise<gladiator_memory[]> =>
  prisma.gladiator_memory.findMany({
    where: { gladiator_id: gladiatorId, memory_type: memoryType, is_active: true },
    orderBy: { priority: 'desc' },
  });

/**
 * Find a memory by ID.
 *
 * @param id - Memory ID.
 * @returns Memory or null.
 */
const findById = async (id: string): Promise<gladiator_memory | null> =>
  prisma.gladiator_memory.findUnique({ where: { id } });

/**
 * Soft-delete a memory by deactivating it.
 *
 * @param id - Memory ID.
 * @returns Updated memory.
 */
const deactivate = async (id: string): Promise<gladiator_memory> =>
  prisma.gladiator_memory.update({ where: { id }, data: { is_active: false } });

/**
 * Hard-delete a memory.
 *
 * @param id - Memory ID.
 * @returns Deleted memory.
 */
const remove = async (id: string): Promise<gladiator_memory> =>
  prisma.gladiator_memory.delete({ where: { id } });

export default { create, findByGladiator, findByType, findById, deactivate, remove };
