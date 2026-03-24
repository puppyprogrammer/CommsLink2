import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

const VALID_MEMORY_TYPES = ['strategy', 'opponent', 'general'];

/**
 * Add a training memory to a gladiator.
 *
 * @param gladiatorId - Gladiator ID.
 * @param userId - Requesting user ID (for ownership check).
 * @param memoryType - Memory category.
 * @param content - Memory content text.
 * @param priority - Priority 1-10.
 * @returns Created memory.
 */
const addMemoryAction = async (
  gladiatorId: string,
  userId: string,
  memoryType: string,
  content: string,
  priority: number,
) =>
  tracer.trace('ACTION.GLADIATOR.ADD_MEMORY', async () => {
    const gladiator = await Data.gladiator.findById(gladiatorId);

    if (!gladiator) throw Boom.notFound('Gladiator not found.');
    if (gladiator.user_id !== userId) throw Boom.forbidden('You do not own this gladiator.');
    if (!VALID_MEMORY_TYPES.includes(memoryType)) throw Boom.badRequest(`Invalid memory type. Must be: ${VALID_MEMORY_TYPES.join(', ')}`);
    if (content.length < 5 || content.length > 2000) throw Boom.badRequest('Memory content must be between 5 and 2000 characters.');
    if (priority < 1 || priority > 10) throw Boom.badRequest('Priority must be between 1 and 10.');

    const existing = await Data.gladiatorMemory.findByGladiator(gladiatorId);
    if (existing.length >= 20) {
      throw Boom.conflict('Maximum 20 active memories per gladiator. Delete one first.');
    }

    return Data.gladiatorMemory.create({
      gladiator_id: gladiatorId,
      memory_type: memoryType,
      content,
      priority,
    });
  });

/**
 * Delete a memory from a gladiator.
 *
 * @param gladiatorId - Gladiator ID.
 * @param memoryId - Memory ID.
 * @param userId - Requesting user ID.
 * @returns Deleted memory.
 */
const deleteMemoryAction = async (gladiatorId: string, memoryId: string, userId: string) =>
  tracer.trace('ACTION.GLADIATOR.DELETE_MEMORY', async () => {
    const gladiator = await Data.gladiator.findById(gladiatorId);

    if (!gladiator) throw Boom.notFound('Gladiator not found.');
    if (gladiator.user_id !== userId) throw Boom.forbidden('You do not own this gladiator.');

    const memory = await Data.gladiatorMemory.findById(memoryId);
    if (!memory) throw Boom.notFound('Memory not found.');
    if (memory.gladiator_id !== gladiatorId) throw Boom.forbidden('Memory does not belong to this gladiator.');

    return Data.gladiatorMemory.remove(memoryId);
  });

/**
 * Get all active memories for a gladiator.
 *
 * @param gladiatorId - Gladiator ID.
 * @returns Active memories.
 */
const getMemoriesAction = async (gladiatorId: string) =>
  tracer.trace('ACTION.GLADIATOR.GET_MEMORIES', async () => {
    const gladiator = await Data.gladiator.findById(gladiatorId);
    if (!gladiator) throw Boom.notFound('Gladiator not found.');

    return Data.gladiatorMemory.findByGladiator(gladiatorId);
  });

export { addMemoryAction, deleteMemoryAction, getMemoriesAction };
