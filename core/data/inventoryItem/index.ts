import prisma from '../../adapters/prisma';
import type { inventory_item } from '../../../prisma/client';

type InventoryItemWithDef = inventory_item & { item_def: import('../../../prisma/client').item_definition };

const findByCharacter = async (characterId: string): Promise<InventoryItemWithDef[]> =>
  prisma.inventory_item.findMany({
    where: { character_id: characterId },
    include: { item_def: true },
    orderBy: { slot_index: 'asc' },
  }) as Promise<InventoryItemWithDef[]>;

const findEquipped = async (characterId: string): Promise<InventoryItemWithDef[]> =>
  prisma.inventory_item.findMany({
    where: { character_id: characterId, is_equipped: true },
    include: { item_def: true },
  }) as Promise<InventoryItemWithDef[]>;

const findById = async (id: string): Promise<InventoryItemWithDef | null> =>
  prisma.inventory_item.findUnique({
    where: { id },
    include: { item_def: true },
  }) as Promise<InventoryItemWithDef | null>;

const addItem = async (
  characterId: string,
  itemDefId: string,
  quantity: number = 1,
  slotIndex?: number,
): Promise<inventory_item> => {
  // If no slot specified, find first open slot (0-27)
  let targetSlot = slotIndex;
  if (targetSlot === undefined) {
    const existing = await prisma.inventory_item.findMany({
      where: { character_id: characterId, is_equipped: false },
      select: { slot_index: true },
    });
    const usedSlots = new Set(existing.map((i) => i.slot_index).filter((s) => s !== null));
    for (let i = 0; i < 28; i++) {
      if (!usedSlots.has(i)) { targetSlot = i; break; }
    }
    if (targetSlot === undefined) throw new Error('Inventory full');
  }

  return prisma.inventory_item.create({
    data: {
      character_id: characterId,
      item_def_id: itemDefId,
      quantity,
      slot_index: targetSlot,
    },
  });
};

const removeItem = async (id: string): Promise<void> => {
  await prisma.inventory_item.delete({ where: { id } });
};

const updateQuantity = async (id: string, quantity: number): Promise<inventory_item> =>
  prisma.inventory_item.update({ where: { id }, data: { quantity } });

const equipItem = async (id: string, equipSlot: string): Promise<inventory_item> =>
  prisma.inventory_item.update({
    where: { id },
    data: { is_equipped: true, equip_slot: equipSlot, slot_index: null },
  });

const unequipItem = async (id: string, slotIndex: number): Promise<inventory_item> =>
  prisma.inventory_item.update({
    where: { id },
    data: { is_equipped: false, equip_slot: null, slot_index: slotIndex },
  });

const moveItem = async (id: string, newSlotIndex: number): Promise<inventory_item> =>
  prisma.inventory_item.update({
    where: { id },
    data: { slot_index: newSlotIndex },
  });

const getEquippedInSlot = async (characterId: string, equipSlot: string): Promise<inventory_item | null> =>
  prisma.inventory_item.findUnique({
    where: { character_id_equip_slot: { character_id: characterId, equip_slot: equipSlot } },
  });

const findFirstOpenSlot = async (characterId: string): Promise<number | null> => {
  const existing = await prisma.inventory_item.findMany({
    where: { character_id: characterId, is_equipped: false },
    select: { slot_index: true },
  });
  const usedSlots = new Set(existing.map((i) => i.slot_index).filter((s) => s !== null));
  for (let i = 0; i < 28; i++) {
    if (!usedSlots.has(i)) return i;
  }
  return null;
};

const findByCharacterAndItem = async (characterId: string, itemDefId: string): Promise<InventoryItemWithDef | null> =>
  prisma.inventory_item.findFirst({
    where: { character_id: characterId, item_def_id: itemDefId, is_equipped: false },
    include: { item_def: true },
  }) as Promise<InventoryItemWithDef | null>;

export type { InventoryItemWithDef };
export default { findByCharacter, findEquipped, findById, addItem, removeItem, updateQuantity, equipItem, unequipItem, moveItem, getEquippedInSlot, findFirstOpenSlot, findByCharacterAndItem };
