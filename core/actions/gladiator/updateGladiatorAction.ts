import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

import type { Prisma } from '../../../prisma/client';

type UpdateFields = {
  name?: string;
  avatar_config?: Prisma.InputJsonValue;
};

/**
 * Update a gladiator's profile fields.
 *
 * @param gladiatorId - Gladiator ID.
 * @param userId - Requesting user ID (for ownership check).
 * @param data - Fields to update.
 * @returns Updated gladiator.
 */
const updateGladiatorAction = async (gladiatorId: string, userId: string, data: UpdateFields) =>
  tracer.trace('ACTION.GLADIATOR.UPDATE', async () => {
    const gladiator = await Data.gladiator.findById(gladiatorId);

    if (!gladiator) {
      throw Boom.notFound('Gladiator not found.');
    }

    if (gladiator.user_id !== userId) {
      throw Boom.forbidden('You do not own this gladiator.');
    }

    if (data.name && (data.name.length < 2 || data.name.length > 30)) {
      throw Boom.badRequest('Gladiator name must be between 2 and 30 characters.');
    }

    return Data.gladiator.update(gladiatorId, data);
  });

export default updateGladiatorAction;
