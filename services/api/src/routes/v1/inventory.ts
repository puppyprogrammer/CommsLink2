import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import getInventoryAction from '../../../../../core/actions/inventory/getInventoryAction';
import equipItemAction from '../../../../../core/actions/inventory/equipItemAction';
import unequipItemAction from '../../../../../core/actions/inventory/unequipItemAction';
import moveItemAction from '../../../../../core/actions/inventory/moveItemAction';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

// ── Starter item definitions ──
const STARTER_ITEMS = [
  { name: 'Iron Broadsword', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Broadsword_01', rarity: 'common', strength_bonus: 5, buy_price: 100, sell_price: 25 },
  { name: 'Steel Rapier', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Rapier_01', rarity: 'uncommon', strength_bonus: 8, speed_bonus: 3, buy_price: 300, sell_price: 75 },
  { name: 'War Halberd', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Halberd_01', rarity: 'rare', strength_bonus: 15, speed_bonus: -3, buy_price: 800, sell_price: 200 },
  { name: 'Zweihander', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Zweihander_01', rarity: 'epic', strength_bonus: 20, speed_bonus: -5, buy_price: 2000, sell_price: 500 },
  { name: 'Wooden Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_01', rarity: 'common', defense_bonus: 5, buy_price: 80, sell_price: 20 },
  { name: 'Iron Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_02', rarity: 'uncommon', defense_bonus: 10, buy_price: 250, sell_price: 60 },
  { name: 'Knight Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_03', rarity: 'rare', defense_bonus: 15, buy_price: 700, sell_price: 175 },
  { name: 'Royal Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_04', rarity: 'epic', defense_bonus: 25, buy_price: 1800, sell_price: 450 },
  { name: 'Health Potion', item_type: 'consumable', slot: null, icon_name: 'potion_health', rarity: 'common', stackable: true, max_stack: 10, health_bonus: 30, buy_price: 50, sell_price: 12 },
  { name: 'Stamina Potion', item_type: 'consumable', slot: null, icon_name: 'potion_stamina', rarity: 'common', stackable: true, max_stack: 10, stamina_bonus: 50, buy_price: 40, sell_price: 10 },
  { name: 'Iron Ore', item_type: 'material', slot: null, icon_name: 'mat_iron', rarity: 'common', stackable: true, max_stack: 50, buy_price: 10, sell_price: 3 },
  { name: 'Gold Coin', item_type: 'material', slot: null, icon_name: 'mat_gold', rarity: 'common', stackable: true, max_stack: 99999, buy_price: 1, sell_price: 1 },

  // Recruits
  { name: 'Peasant Levy', item_type: 'recruit', slot: null, icon_name: 'recruit_peasant', rarity: 'common', strength_bonus: 6, defense_bonus: 4, speed_bonus: 8, health_bonus: 60, buy_price: 50, sell_price: 0 },
  { name: 'Militia Swordsman', item_type: 'recruit', slot: null, icon_name: 'recruit_militia', rarity: 'common', strength_bonus: 10, defense_bonus: 8, speed_bonus: 8, health_bonus: 80, buy_price: 150, sell_price: 0 },
  { name: 'Man-at-Arms', item_type: 'recruit', slot: null, icon_name: 'recruit_manatarms', rarity: 'uncommon', strength_bonus: 14, defense_bonus: 12, speed_bonus: 8, health_bonus: 100, buy_price: 500, sell_price: 0 },
  { name: 'Veteran Knight', item_type: 'recruit', slot: null, icon_name: 'recruit_veteran', rarity: 'rare', strength_bonus: 18, defense_bonus: 16, speed_bonus: 10, health_bonus: 130, buy_price: 2000, sell_price: 0 },
  { name: 'Elite Champion', item_type: 'recruit', slot: null, icon_name: 'recruit_champion', rarity: 'epic', strength_bonus: 24, defense_bonus: 20, speed_bonus: 12, health_bonus: 160, buy_price: 5000, sell_price: 0 },
  { name: 'Crossbowman', item_type: 'recruit', slot: null, icon_name: 'recruit_crossbow', rarity: 'uncommon', strength_bonus: 16, defense_bonus: 6, speed_bonus: 6, health_bonus: 70, buy_price: 400, sell_price: 0 },
  { name: 'Shield Bearer', item_type: 'recruit', slot: null, icon_name: 'recruit_shield', rarity: 'uncommon', strength_bonus: 8, defense_bonus: 20, speed_bonus: 6, health_bonus: 120, buy_price: 600, sell_price: 0 },
];

const inventoryRoutes: ServerRoute[] = [
  // ── Get inventory ──
  {
    method: 'GET',
    path: '/api/v1/inventory',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.INVENTORY.GET', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return getInventoryAction(credentials.id);
      }),
  },

  // ── Equip item ──
  {
    method: 'POST',
    path: '/api/v1/inventory/equip',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({ inventory_item_id: Joi.string().uuid().required() }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.INVENTORY.EQUIP', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { inventory_item_id } = request.payload as { inventory_item_id: string };
        return equipItemAction(inventory_item_id, credentials.id);
      }),
  },

  // ── Unequip item ──
  {
    method: 'POST',
    path: '/api/v1/inventory/unequip',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({ inventory_item_id: Joi.string().uuid().required() }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.INVENTORY.UNEQUIP', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { inventory_item_id } = request.payload as { inventory_item_id: string };
        return unequipItemAction(inventory_item_id, credentials.id);
      }),
  },

  // ── Move item ──
  {
    method: 'POST',
    path: '/api/v1/inventory/move',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          inventory_item_id: Joi.string().uuid().required(),
          slot_index: Joi.number().integer().min(0).max(27).required(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.INVENTORY.MOVE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { inventory_item_id, slot_index } = request.payload as { inventory_item_id: string; slot_index: number };
        return moveItemAction(inventory_item_id, slot_index, credentials.id);
      }),
  },

  // ── Get all item definitions (public catalog) ──
  {
    method: 'GET',
    path: '/api/v1/items',
    options: { auth: false },
    handler: async () =>
      tracer.trace('CONTROLLER.ITEMS.LIST', async () => Data.itemDefinition.findAll()),
  },

  // ── Seed item definitions (admin only) ──
  {
    method: 'POST',
    path: '/api/v1/items/seed',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.ITEMS.SEED', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        const results = [];
        for (const item of STARTER_ITEMS) {
          const data = {
            name: item.name,
            description: null,
            icon_name: item.icon_name,
            item_type: item.item_type,
            slot: item.slot ?? null,
            rarity: item.rarity,
            stackable: 'stackable' in item ? item.stackable as boolean : false,
            max_stack: 'max_stack' in item ? item.max_stack as number : 1,
            strength_bonus: 'strength_bonus' in item ? item.strength_bonus as number : 0,
            defense_bonus: 'defense_bonus' in item ? item.defense_bonus as number : 0,
            speed_bonus: 'speed_bonus' in item ? item.speed_bonus as number : 0,
            health_bonus: 'health_bonus' in item ? item.health_bonus as number : 0,
            stamina_bonus: 'stamina_bonus' in item ? item.stamina_bonus as number : 0,
            buy_price: item.buy_price,
            sell_price: item.sell_price,
          };
          const created = await Data.itemDefinition.upsertByName(data as Parameters<typeof Data.itemDefinition.upsertByName>[0]);
          results.push(created);
        }

        return h.response({ seeded: results.length, items: results }).code(201);
      }),
  },
];

export { inventoryRoutes };
