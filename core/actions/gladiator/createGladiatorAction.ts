import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

/**
 * Create a new gladiator for a user.
 *
 * @param userId - Owner user ID.
 * @param name - Gladiator display name.
 * @returns Created gladiator with stats.
 */
const createGladiatorAction = async (userId: string, name: string) =>
  tracer.trace('ACTION.GLADIATOR.CREATE', async () => {
    const existing = await Data.gladiator.findByUser(userId);
    const active = existing.filter((g) => g.is_active);

    if (active.length >= 1) {
      throw Boom.conflict('You already have an active gladiator. Phase 1 allows one per account.');
    }

    if (name.length < 2 || name.length > 30) {
      throw Boom.badRequest('Gladiator name must be between 2 and 30 characters.');
    }

    const gladiator = await Data.gladiator.create({
      user_id: userId,
      name,
    });

    return gladiator;
  });

export default createGladiatorAction;
