import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';
import prisma from '../../../../../core/adapters/prisma';
import { broadcastAll } from '../../handlers/gameSync/combat';

import type { ServerRoute, Request } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const worldNpcRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/world/npcs',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.NPCS.LIST', async () => {
        const cx = parseFloat(request.query.cx as string || '0');
        const cz = parseFloat(request.query.cz as string || '0');
        const radius = parseFloat(request.query.radius as string || '500');

        const npcs = await prisma.world_npc.findMany({
          where: {
            x: { gte: cx - radius, lte: cx + radius },
            z: { gte: cz - radius, lte: cz + radius },
          },
          select: { id: true, x: true, y: true, z: true, npc_name: true, title: true, shop_name: true, prefab_name: true, interact_range: true },
        });

        return { npcs };
      }),
  },

  {
    method: 'POST',
    path: '/api/v1/world/npcs',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          x: Joi.number().required(),
          y: Joi.number().default(0),
          z: Joi.number().required(),
          npc_name: Joi.string().required(),
          title: Joi.string().required(),
          shop_name: Joi.string().required(),
          prefab_name: Joi.string().required(),
          interact_range: Joi.number().default(3.5),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.NPCS.CREATE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const payload = request.payload as {
          x: number; y: number; z: number; npc_name: string; title: string;
          shop_name: string; prefab_name: string; interact_range: number;
        };

        const npc = await prisma.world_npc.create({
          data: { ...payload, placed_by: credentials.id },
        });

        // Broadcast to all connected game-sync clients
        broadcastAll({
          type: 'world_npc_placed',
          id: npc.id,
          x: npc.x,
          y: npc.y,
          z: npc.z,
          npc_name: npc.npc_name,
          title: npc.title,
          shop_name: npc.shop_name,
          prefab_name: npc.prefab_name,
          interact_range: npc.interact_range,
        });

        console.log(`[WorldNPC] ${credentials.username} placed ${npc.npc_name} at (${npc.x.toFixed(0)}, ${npc.z.toFixed(0)})`);
        return npc;
      }),
  },

  {
    method: 'DELETE',
    path: '/api/v1/world/npcs/{id}',
    options: {
      auth: 'jwt',
      validate: { params: Joi.object({ id: Joi.number().integer().required() }) },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.WORLD.NPCS.DELETE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        if (!credentials.is_admin) throw Boom.forbidden('Admin access required');

        const id = parseInt(request.params.id as string, 10);
        await prisma.world_npc.delete({ where: { id } });

        return { removed: true };
      }),
  },
];

export { worldNpcRoutes };
