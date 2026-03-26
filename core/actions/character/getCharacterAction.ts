import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';
import type { player_character } from '../../../prisma/client';

/** Get a user's player character. Throws 404 if none exists. */
const getCharacterAction = async (userId: string): Promise<player_character> =>
  tracer.trace('ACTION.CHARACTER.GET', async () => {
    const character = await Data.playerCharacter.findByUserId(userId);
    if (!character) {
      throw Boom.notFound('Character not found');
    }
    return character;
  });

export default getCharacterAction;
