import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';

/** Get a character's full inventory and equipped items. */
const getInventoryAction = async (userId: string) =>
  tracer.trace('ACTION.INVENTORY.GET', async () => {
    const character = await Data.playerCharacter.findByUserId(userId);
    if (!character) throw Boom.notFound('Character not found');

    const allItems = await Data.inventoryItem.findByCharacter(character.id);
    const inventory = allItems.filter((i) => !i.is_equipped);
    const equipped = allItems.filter((i) => i.is_equipped).map((i) => ({
      equip_slot: i.equip_slot,
      item: i,
    }));

    return { inventory, equipped };
  });

export default getInventoryAction;
