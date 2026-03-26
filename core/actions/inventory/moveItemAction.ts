import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';
import prisma from '../../adapters/prisma';

/** Move an inventory item to a different slot. Swaps if target is occupied. */
const moveItemAction = async (inventoryItemId: string, targetSlotIndex: number, userId: string) =>
  tracer.trace('ACTION.INVENTORY.MOVE', async () => {
    if (targetSlotIndex < 0 || targetSlotIndex > 27) throw Boom.badRequest('Invalid slot index');

    const character = await Data.playerCharacter.findByUserId(userId);
    if (!character) throw Boom.notFound('Character not found');

    const item = await Data.inventoryItem.findById(inventoryItemId);
    if (!item) throw Boom.notFound('Item not found');
    if (item.character_id !== character.id) throw Boom.forbidden('Not your item');
    if (item.is_equipped) throw Boom.badRequest('Cannot move equipped item');

    // Check if target slot is occupied
    const allItems = await Data.inventoryItem.findByCharacter(character.id);
    const occupant = allItems.find((i) => !i.is_equipped && i.slot_index === targetSlotIndex);

    if (occupant && occupant.id !== item.id) {
      // Swap: move occupant to item's old slot
      const oldSlot = item.slot_index;
      await prisma.$transaction([
        prisma.inventory_item.update({ where: { id: item.id }, data: { slot_index: -1 } }), // temp
        prisma.inventory_item.update({ where: { id: occupant.id }, data: { slot_index: oldSlot } }),
        prisma.inventory_item.update({ where: { id: item.id }, data: { slot_index: targetSlotIndex } }),
      ]);
    } else {
      await Data.inventoryItem.moveItem(inventoryItemId, targetSlotIndex);
    }

    return Data.inventoryItem.findByCharacter(character.id);
  });

export default moveItemAction;
