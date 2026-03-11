import Joi from 'joi';
import tracer from '../../../../../core/lib/tracer';

import loginAction from '../../../../../core/actions/auth/loginAction';
import registerAction from '../../../../../core/actions/auth/registerAction';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

const authRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/api/v1/auth/register',
    options: {
      auth: false,
      validate: {
        payload: Joi.object({
          username: Joi.string().min(3).max(30).alphanum().required(),
          password: Joi.string().min(6).max(128).required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.AUTH.REGISTER', async () => {
        const { username, password } = request.payload as { username: string; password: string };
        return registerAction(username, password);
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    options: {
      auth: false,
      validate: {
        payload: Joi.object({
          username: Joi.string().required(),
          password: Joi.string().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.AUTH.LOGIN', async () => {
        const { username, password } = request.payload as { username: string; password: string };
        return loginAction(username, password);
      }),
  },
];

export { authRoutes };
