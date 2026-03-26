import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';

type AddXPResult = {
  xp: number;
  level: number;
  leveled_up: boolean;
  previous_level: number;
};

/** Add XP to a character and handle level-ups based on DB level definitions. */
const addXPAction = async (characterId: string, xpAmount: number): Promise<AddXPResult> =>
  tracer.trace('ACTION.CHARACTER.ADD_XP', async () => {
    const character = await Data.playerCharacter.findById(characterId);
    if (!character) throw Boom.notFound('Character not found');

    const newXP = character.xp + xpAmount;
    const levels = await Data.levelDefinition.findAll();

    // Find new level based on total XP
    let newLevel = 1;
    for (const lvl of levels) {
      if (newXP >= lvl.xp_required) {
        newLevel = lvl.level;
      } else {
        break;
      }
    }

    const leveledUp = newLevel > character.level;

    await Data.playerCharacter.update(character.id, {
      xp: newXP,
      level: newLevel,
    });

    return {
      xp: newXP,
      level: newLevel,
      leveled_up: leveledUp,
      previous_level: character.level,
    };
  });

export default addXPAction;
