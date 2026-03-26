import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';
import prisma from '../../adapters/prisma';

/** Equip an inventory item. Swaps with existing if slot occupied. */
const equipItemAction = async (inventoryItemId: string, userId: string) =>
  tracer.trace('ACTION.INVENTORY.EQUIP', async () => {
    const character = await Data.playerCharacter.findByUserId(userId);
    if (!character) throw Boom.notFound('Character not found');

    const item = await Data.inventoryItem.findById(inventoryItemId);
    if (!item) throw Boom.notFound('Item not found');
    if (item.character_id !== character.id) throw Boom.forbidden('Not your item');
    if (!item.item_def.slot) throw Boom.badRequest('Item is not equippable');
    if (item.is_equipped) throw Boom.badRequest('Item is already equipped');

    const targetSlot = item.item_def.slot;
    const itemSlotIndex = item.slot_index;

    // Check if something is already equipped in that equip slot
    const existing = await Data.inventoryItem.getEquippedInSlot(character.id, targetSlot);

    if (existing) {
      // Swap: must unequip existing FIRST to free the equip_slot constraint,
      // then clear the new item's inventory slot, then equip it.
      // Use interactive transaction for sequential execution.
      await prisma.$transaction(async (tx) => {
        // 1. Unequip existing → move to temp slot -1 (avoids slot_index conflict)
        await tx.inventory_item.update({
          where: { id: existing.id },
          data: { is_equipped: false, equip_slot: null, slot_index: -1 },
        });
        // 2. Equip new item → frees its inventory slot
        await tx.inventory_item.update({
          where: { id: inventoryItemId },
          data: { is_equipped: true, equip_slot: targetSlot, slot_index: null },
        });
        // 3. Move old item into the freed inventory slot
        await tx.inventory_item.update({
          where: { id: existing.id },
          data: { slot_index: itemSlotIndex },
        });
      });
    } else {
      // No existing — just equip
      await Data.inventoryItem.equipItem(inventoryItemId, targetSlot);
    }

    return Data.inventoryItem.findByCharacter(character.id);
  });

export default equipItemAction;
