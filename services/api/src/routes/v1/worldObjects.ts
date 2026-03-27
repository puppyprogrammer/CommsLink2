import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';
import prisma from '../../../../../core/adapters/prisma';
import { broadcastNearby } from '../../handlers/gameSync/vegetation';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const worldObjectRoutes: ServerRoute[] = [
  // ── Get world objects near position ──
  {
    method: 'GET',
    path: '/api/v1/world/objects',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.OBJECTS', async () => {
        const cx = parseFloat(request.query.cx as string || '0');
        const cz = parseFloat(request.query.cz as string || '0');
        const radius = parseFloat(request.query.radius as string || '300');

        const objects = await prisma.world_object.findMany({
          where: {
            x: { gte: cx - radius, lte: cx + radius },
            z: { gte: cz - radius, lte: cz + radius },
          },
          select: { id: true, x: true, y: true, z: true, rot_y: true, scale: true, prefab_name: true, category: true },
        });

        return { objects };
      }),
  },

  // ── Place world object (admin only) ──
  {
    method: 'POST',
    path: '/api/v1/world/objects',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          x: Joi.number().required(),
          y: Joi.number().default(0),
          z: Joi.number().required(),
          rot_y: Joi.number().default(0),
          scale: Joi.number().default(1),
          prefab_name: Joi.string().required(),
          category: Joi.string().valid('building', 'prop', 'decoration', 'structure').default('building'),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.OBJECTS.PLACE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        const payload = request.payload as {
          x: number; y: number; z: number; rot_y: number; scale: number; prefab_name: string; category: string;
        };

        const obj = await prisma.world_object.create({
          data: { ...payload, placed_by: credentials.id },
        });

        broadcastNearby(obj.x, obj.z, 300, {
          type: 'world_object_placed',
          id: obj.id, x: obj.x, y: obj.y, z: obj.z,
          rot_y: obj.rot_y, scale: obj.scale,
          prefab_name: obj.prefab_name, category: obj.category,
        });

        return obj;
      }),
  },

  // ── Remove world object (admin only) ──
  {
    method: 'DELETE',
    path: '/api/v1/world/objects/{id}',
    options: {
      auth: 'jwt',
      validate: { params: Joi.object({ id: Joi.number().integer().required() }) },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.OBJECTS.REMOVE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        const id = parseInt(request.params.id as string, 10);
        const obj = await prisma.world_object.findUnique({ where: { id } });
        if (!obj) throw Boom.notFound('Object not found');

        await prisma.world_object.delete({ where: { id } });

        broadcastNearby(obj.x, obj.z, 300, { type: 'world_object_removed', id });

        return { removed: true };
      }),
  },

  // ── Bulk seed world objects (admin only) ──
  {
    method: 'POST',
    path: '/api/v1/world/objects/seed',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          objects: Joi.array().items(Joi.object({
            x: Joi.number().required(),
            y: Joi.number().default(0),
            z: Joi.number().required(),
            rot_y: Joi.number().default(0),
            scale: Joi.number().default(1),
            prefab_name: Joi.string().required(),
            category: Joi.string().default('building'),
          })).required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.WORLD.OBJECTS.SEED', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        const { objects } = request.payload as { objects: Array<{
          x: number; y: number; z: number; rot_y: number; scale: number; prefab_name: string; category: string;
        }> };

        let count = 0;
        for (const obj of objects) {
          await prisma.world_object.create({ data: obj });
          count++;
        }

        console.log(`[WorldObjects] Seeded ${count} objects`);
        return h.response({ seeded: count }).code(201);
      }),
  },
];

export { worldObjectRoutes };
