import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import createGladiatorAction from '../../../../../core/actions/gladiator/createGladiatorAction';
import getGladiatorAction from '../../../../../core/actions/gladiator/getGladiatorAction';
import updateGladiatorAction from '../../../../../core/actions/gladiator/updateGladiatorAction';
import { addMemoryAction, deleteMemoryAction, getMemoriesAction } from '../../../../../core/actions/gladiator/manageMemoryAction';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

interface AuthCredentials {
  id: string;
  username: string;
  email: string | null;
  is_admin: boolean;
}

const gladiatorRoutes: ServerRoute[] = [
  // ┌──────────────────────────────────────────┐
  // │ Create Gladiator                         │
  // └──────────────────────────────────────────┘
  {
    method: 'POST',
    path: '/api/v1/gladiators',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          name: Joi.string().min(2).max(30).required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.CREATE', async () => {
        const { id: userId } = request.auth.credentials as unknown as AuthCredentials;
        const { name } = request.payload as { name: string };
        return createGladiatorAction(userId, name);
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Get Gladiator                            │
  // └──────────────────────────────────────────┘
  {
    method: 'GET',
    path: '/api/v1/gladiators/{id}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          id: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.GET', async () => {
        const { id } = request.params;
        return getGladiatorAction(id);
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Update Gladiator                         │
  // └──────────────────────────────────────────┘
  {
    method: 'PUT',
    path: '/api/v1/gladiators/{id}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          id: Joi.string().uuid().required(),
        }),
        payload: Joi.object({
          name: Joi.string().min(2).max(30).optional(),
          avatar_config: Joi.object().optional(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.UPDATE', async () => {
        const { id: userId } = request.auth.credentials as unknown as AuthCredentials;
        const { id } = request.params;
        const payload = request.payload as { name?: string; avatar_config?: Record<string, unknown> };
        return updateGladiatorAction(id, userId, payload);
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Get User's Gladiators                    │
  // └──────────────────────────────────────────┘
  {
    method: 'GET',
    path: '/api/v1/gladiators/user/{userId}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          userId: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.GET_BY_USER', async () => {
        const { userId } = request.params;
        return { gladiators: await Data.gladiator.findByUser(userId) };
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Get Memories                             │
  // └──────────────────────────────────────────┘
  {
    method: 'GET',
    path: '/api/v1/gladiators/{id}/memories',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          id: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.GET_MEMORIES', async () => {
        const { id } = request.params;
        return { memories: await getMemoriesAction(id) };
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Add Memory                               │
  // └──────────────────────────────────────────┘
  {
    method: 'POST',
    path: '/api/v1/gladiators/{id}/memories',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          id: Joi.string().uuid().required(),
        }),
        payload: Joi.object({
          memory_type: Joi.string().valid('strategy', 'opponent', 'general').required(),
          content: Joi.string().min(5).max(2000).required(),
          priority: Joi.number().integer().min(1).max(10).default(5),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.ADD_MEMORY', async () => {
        const { id: userId } = request.auth.credentials as unknown as AuthCredentials;
        const { id } = request.params;
        const { memory_type, content, priority } = request.payload as {
          memory_type: string;
          content: string;
          priority: number;
        };
        return addMemoryAction(id, userId, memory_type, content, priority);
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Delete Memory                            │
  // └──────────────────────────────────────────┘
  {
    method: 'DELETE',
    path: '/api/v1/gladiators/{id}/memories/{memId}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          id: Joi.string().uuid().required(),
          memId: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.DELETE_MEMORY', async () => {
        const { id: userId } = request.auth.credentials as unknown as AuthCredentials;
        const { id, memId } = request.params;
        await deleteMemoryAction(id, memId, userId);
        return { success: true };
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Leaderboard                              │
  // └──────────────────────────────────────────┘
  {
    method: 'GET',
    path: '/api/v1/leaderboard',
    options: {
      auth: 'jwt',
      validate: {
        query: Joi.object({
          limit: Joi.number().integer().min(1).max(100).default(50),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.GLADIATOR.LEADERBOARD', async () => {
        const { limit } = request.query as { limit: number };
        return { leaderboard: await Data.gladiator.leaderboard(limit) };
      }),
  },
];

export { gladiatorRoutes };
