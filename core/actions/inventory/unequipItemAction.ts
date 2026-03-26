import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';

/** Unequip an item, placing it in the first open inventory slot. */
const unequipItemAction = async (inventoryItemId: string, userId: string) =>
  tracer.trace('ACTION.INVENTORY.UNEQUIP', async () => {
    const character = await Data.playerCharacter.findByUserId(userId);
    if (!character) throw Boom.notFound('Character not found');

    const item = await Data.inventoryItem.findById(inventoryItemId);
    if (!item) throw Boom.notFound('Item not found');
    if (item.character_id !== character.id) throw Boom.forbidden('Not your item');
    if (!item.is_equipped) throw Boom.badRequest('Item is not equipped');

    const openSlot = await Data.inventoryItem.findFirstOpenSlot(character.id);
    if (openSlot === null) throw Boom.badRequest('Inventory full');

    await Data.inventoryItem.unequipItem(inventoryItemId, openSlot);

    return Data.inventoryItem.findByCharacter(character.id);
  });

export default unequipItemAction;
