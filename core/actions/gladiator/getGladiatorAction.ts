import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';

/**
 * Get a single gladiator by ID.
 *
 * @param gladiatorId - Gladiator ID.
 * @returns Gladiator with stats.
 */
const getGladiatorAction = async (gladiatorId: string) =>
  tracer.trace('ACTION.GLADIATOR.GET', async () => {
    const gladiator = await Data.gladiator.findById(gladiatorId);

    if (!gladiator) {
      throw Boom.notFound('Gladiator not found.');
    }

    return gladiator;
  });

export default getGladiatorAction;
