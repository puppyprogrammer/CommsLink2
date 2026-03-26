import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';
import prisma from '../../../../../core/adapters/prisma';
import Data from '../../../../../core/data';
import { broadcastNearby } from '../../handlers/gameSync/vegetation';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const worldRoutes: ServerRoute[] = [
  // ── Get vegetation near position ──
  {
    method: 'GET',
    path: '/api/v1/world/vegetation',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.VEGETATION', async () => {
        const cx = parseFloat(request.query.cx as string || '0');
        const cz = parseFloat(request.query.cz as string || '0');
        const radius = parseFloat(request.query.radius as string || '200');

        const vegetation = await prisma.world_vegetation.findMany({
          where: {
            x: { gte: cx - radius, lte: cx + radius },
            z: { gte: cz - radius, lte: cz + radius },
            health: { gt: 0 },
          },
          select: { id: true, x: true, z: true, type: true, growth_stage: true, health: true },
        });

        return { vegetation };
      }),
  },

  // ── Plant vegetation ──
  {
    method: 'POST',
    path: '/api/v1/world/vegetation/plant',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          x: Joi.number().required(),
          z: Joi.number().required(),
          type: Joi.string().valid('grass', 'bush', 'tree_oak', 'tree_pine').required(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.PLANT', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { x, z, type } = request.payload as { x: number; z: number; type: string };

        // Check for seed in inventory
        const character = await Data.playerCharacter.findByUserId(credentials.id);
        if (!character) throw Boom.notFound('Character not found');

        const seedNames: Record<string, string> = {
          grass: 'Grass Seed',
          bush: 'Bush Seed',
          tree_oak: 'Oak Seed',
          tree_pine: 'Pine Seed',
        };
        const seedName = seedNames[type];
        if (seedName) {
          const seedDef = await Data.itemDefinition.findByName(seedName);
          if (seedDef) {
            const seedItem = await Data.inventoryItem.findByCharacterAndItem(character.id, seedDef.id);
            if (!seedItem || seedItem.quantity < 1) {
              throw Boom.conflict(`You need a ${seedName} to plant this`);
            }
            // Consume seed
            if (seedItem.quantity <= 1) {
              await Data.inventoryItem.removeItem(seedItem.id);
            } else {
              await Data.inventoryItem.updateQuantity(seedItem.id, seedItem.quantity - 1);
            }
          }
          // If seed item doesn't exist in definitions, allow free planting (seeds not yet added)
        }

        const veg = await prisma.world_vegetation.create({
          data: { x, z, type, growth_stage: 0, health: 100, planted_by: credentials.id },
        });

        broadcastNearby(x, z, 200, {
          type: 'vegetation_spawned',
          id: veg.id, x, z, vegType: type, growth_stage: 0, health: 100,
        });

        return veg;
      }),
  },

  // ── Seed initial vegetation (admin only) ──
  {
    method: 'POST',
    path: '/api/v1/world/vegetation/seed',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.WORLD.SEED', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        let grassCount = 0;
        let treeCount = 0;

        // 500 grass patches
        for (let i = 0; i < 500; i++) {
          await prisma.world_vegetation.create({
            data: {
              x: (Math.random() - 0.5) * 200,
              z: (Math.random() - 0.5) * 200,
              type: 'grass',
              growth_stage: Math.floor(Math.random() * 5),
              health: 100,
            },
          });
          grassCount++;
        }

        // 30 oak trees
        for (let i = 0; i < 30; i++) {
          await prisma.world_vegetation.create({
            data: {
              x: (Math.random() - 0.5) * 200,
              z: (Math.random() - 0.5) * 200,
              type: 'tree_oak',
              growth_stage: Math.floor(Math.random() * 5),
              health: 100,
            },
          });
          treeCount++;
        }

        // 20 pine trees
        for (let i = 0; i < 20; i++) {
          await prisma.world_vegetation.create({
            data: {
              x: (Math.random() - 0.5) * 200,
              z: (Math.random() - 0.5) * 200,
              type: 'tree_pine',
              growth_stage: Math.floor(Math.random() * 5),
              health: 100,
            },
          });
          treeCount++;
        }

        console.log(`[Vegetation] Seeded ${grassCount} grass + ${treeCount} trees`);
        return h.response({ grass: grassCount, trees: treeCount }).code(201);
      }),
  },
];

export { worldRoutes };
