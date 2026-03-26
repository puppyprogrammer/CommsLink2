import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import buyItemAction from '../../../../../core/actions/shop/buyItemAction';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const shopRoutes: ServerRoute[] = [
  // ── List all shops ──
  {
    method: 'GET',
    path: '/api/v1/shops',
    options: { auth: 'jwt' },
    handler: async () =>
      tracer.trace('CONTROLLER.SHOPS.LIST', async () => Data.shop.findAll()),
  },

  // ── Get shop with stock ──
  {
    method: 'GET',
    path: '/api/v1/shops/{name}',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.SHOPS.GET', async () => {
        const { name } = request.params;
        const shop = await Data.shop.findByName(name);
        if (!shop) throw Boom.notFound('Shop not found');

        const stockItems = await Data.shopStock.findByShop(shop.id);
        const stock = stockItems.map((s) => ({
          item_def_id: s.item_def_id,
          quantity: s.quantity,
          price: s.price_override ?? Math.round((s.item_def as { buy_price: number }).buy_price * shop.buy_markup),
          item_def: s.item_def,
        }));

        return {
          id: shop.id,
          name: shop.name,
          display_name: shop.display_name,
          shop_type: shop.shop_type,
          description: shop.description,
          stock,
        };
      }),
  },

  // ── Buy item from shop ──
  {
    method: 'POST',
    path: '/api/v1/shops/{name}/buy',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          item_def_id: Joi.string().uuid().required(),
          quantity: Joi.number().integer().min(1).max(99).required(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.SHOPS.BUY', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { name } = request.params;
        const { item_def_id, quantity } = request.payload as { item_def_id: string; quantity: number };
        return buyItemAction(name, item_def_id, quantity, credentials.id);
      }),
  },

  // ── Seed shops (admin only) ──
  {
    method: 'POST',
    path: '/api/v1/shops/seed',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.SHOPS.SEED', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        // Create mercenary recruiter shop
        const existing = await Data.shop.findByName('mercenary_recruiter');
        const shop = existing || await Data.shop.create({
          name: 'mercenary_recruiter',
          display_name: "Commander Roderick's War Camp",
          shop_type: 'recruiter',
          description: 'Battle-hardened veterans and fine weapons, available for the right price.',
          buy_markup: 1.0,
        });

        // Stock with recruits only
        const recruits = await Data.itemDefinition.findByType('recruit');
        const weapons = await Data.itemDefinition.findByType('weapon');
        const shields = await Data.itemDefinition.findByType('shield');
        const consumables = await Data.itemDefinition.findByType('consumable');

        let stocked = 0;
        for (const item of recruits) {
          const exists = await Data.shopStock.findByShopAndItem(shop.id, item.id);
          if (!exists) {
            await Data.shopStock.create({ shop_id: shop.id, item_def_id: item.id, quantity: -1 });
            stocked++;
          }
        }

        // Create village blacksmith
        const blacksmithExisting = await Data.shop.findByName('village_blacksmith');
        const blacksmith = blacksmithExisting || await Data.shop.create({
          name: 'village_blacksmith',
          display_name: "Bjorn's Forge",
          shop_type: 'blacksmith',
          description: 'The finest steel this side of the mountains. Weapons and armor forged with care.',
          buy_markup: 1.2,
        });

        for (const item of [...weapons, ...shields]) {
          const exists = await Data.shopStock.findByShopAndItem(blacksmith.id, item.id);
          if (!exists) {
            await Data.shopStock.create({ shop_id: blacksmith.id, item_def_id: item.id, quantity: -1 });
            stocked++;
          }
        }

        // Create potion seller
        const potionExisting = await Data.shop.findByName('potion_seller');
        const potionSeller = potionExisting || await Data.shop.create({
          name: 'potion_seller',
          display_name: "Elara's Remedies",
          shop_type: 'potion_seller',
          description: 'Potions and elixirs for the weary adventurer. Healing guaranteed or your gold back.',
          buy_markup: 1.0,
        });

        for (const item of consumables) {
          const exists = await Data.shopStock.findByShopAndItem(potionSeller.id, item.id);
          if (!exists) {
            await Data.shopStock.create({ shop_id: potionSeller.id, item_def_id: item.id, quantity: -1 });
            stocked++;
          }
        }

        return h.response({ seeded: true, shops: 3, items_stocked: stocked }).code(201);
      }),
  },
];

export { shopRoutes };
