import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';
import giveStarterItems from '../inventory/giveStarterItems';
import type { player_character } from '../../../prisma/client';

/** Create a new player character for a user. One character per account. */
const createCharacterAction = async (userId: string, name: string): Promise<player_character> =>
  tracer.trace('ACTION.CHARACTER.CREATE', async () => {
    const existing = await Data.playerCharacter.findByUserId(userId);
    if (existing) {
      throw Boom.conflict('Character already exists');
    }

    const character = await Data.playerCharacter.create({ user_id: userId, name });

    // Give starter items (fire and forget — don't block character creation if items fail)
    giveStarterItems(character.id).catch((err) => {
      console.error(`[GameWorld] Failed to give starter items to ${character.id}:`, err);
    });

    return character;
  });

export default createCharacterAction;
