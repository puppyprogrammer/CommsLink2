import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import Data from '../../../../../core/data';
import createThreadAction from '../../../../../core/actions/forum/createThreadAction';
import createPostAction from '../../../../../core/actions/forum/createPostAction';
import deletePostAction from '../../../../../core/actions/forum/deletePostAction';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const forumRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/forum/threads',
    options: {
      auth: false,
      validate: {
        query: Joi.object({
          page: Joi.number().integer().min(1).default(1),
          limit: Joi.number().integer().min(1).max(50).default(20),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FORUM.GET_THREADS', async () => {
        const { page, limit } = request.query as unknown as { page: number; limit: number };
        return Data.thread.findAll({ skip: (page - 1) * limit, take: limit });
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/forum/threads/{threadId}',
    options: {
      auth: false,
      validate: {
        params: Joi.object({
          threadId: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FORUM.GET_THREAD', async () => {
        const { threadId } = request.params as { threadId: string };
        const thread = await Data.thread.findById(threadId);

        if (!thread) {
          throw Boom.notFound('Thread not found');
        }

        Data.thread.incrementViewCount(threadId).catch(console.error);

        const posts = await Data.post.findByThreadId(threadId, { skip: 0, take: 100 });
        return { thread, posts };
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/forum/threads',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          title: Joi.string().min(3).max(200).required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FORUM.CREATE_THREAD', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { title } = request.payload as { title: string };
        return createThreadAction({
          title,
          author_id: credentials.id,
          author_username: credentials.username,
        });
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/forum/threads/{threadId}/posts',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          threadId: Joi.string().uuid().required(),
        }),
        payload: Joi.object({
          content: Joi.string().min(1).max(10000).required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FORUM.CREATE_POST', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { threadId } = request.params as { threadId: string };
        const { content } = request.payload as { content: string };
        return createPostAction({
          thread_id: threadId,
          author_id: credentials.id,
          author_username: credentials.username,
          content,
        });
      }),
  },
  {
    method: 'DELETE',
    path: '/api/v1/forum/posts/{postId}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          postId: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FORUM.DELETE_POST', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { postId } = request.params as { postId: string };
        return deletePostAction(postId, credentials.id);
      }),
  },
  // ┌──────────────────────────────────────────┐
  // │ Room-scoped Forum Endpoints              │
  // └──────────────────────────────────────────┘
  {
    method: 'GET',
    path: '/api/v1/forum/rooms/{roomId}/threads',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({ roomId: Joi.string().uuid().required() }),
        query: Joi.object({
          page: Joi.number().integer().min(1).default(1),
          limit: Joi.number().integer().min(1).max(50).default(20),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FORUM.GET_ROOM_THREADS', async () => {
        const { roomId } = request.params as { roomId: string };
        const { page, limit } = request.query as unknown as { page: number; limit: number };
        return Data.thread.findByRoomId(roomId, { skip: (page - 1) * limit, take: limit });
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/forum/rooms/{roomId}/threads/{threadId}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          roomId: Joi.string().uuid().required(),
          threadId: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FORUM.GET_ROOM_THREAD', async () => {
        const { threadId } = request.params as { threadId: string };
        const thread = await Data.thread.findById(threadId);
        if (!thread) throw Boom.notFound('Thread not found');
        Data.thread.incrementViewCount(threadId).catch(console.error);
        const posts = await Data.post.findByThreadId(threadId, { skip: 0, take: 100 });
        return { thread, posts };
      }),
  },
];

export { forumRoutes };
