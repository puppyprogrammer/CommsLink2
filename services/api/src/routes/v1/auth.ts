import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import loginAction from '../../../../../core/actions/auth/loginAction';
import registerAction from '../../../../../core/actions/auth/registerAction';
import { checkRateLimit } from '../../../../../core/helpers/rateLimiter';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  }
  return request.info.remoteAddress;
}

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
          email: Joi.string().email().optional().allow(''),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.AUTH.REGISTER', async () => {
        const ip = getClientIp(request);
        const { allowed, retryAfterMs } = checkRateLimit(`register:${ip}`, 3, 60_000);
        if (!allowed) {
          throw Boom.tooManyRequests(
            `Too many registration attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
          );
        }

        const { username, password, email } = request.payload as { username: string; password: string; email?: string };
        const result = await registerAction(username, password, email);
        Data.auditLog.create({
          event: 'account_created',
          username,
          ip_address: ip,
        }).catch(console.error);
        return result;
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
        const ip = getClientIp(request);
        const { allowed, retryAfterMs } = checkRateLimit(`login:${ip}`, 5, 60_000);
        if (!allowed) {
          throw Boom.tooManyRequests(
            `Too many login attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
          );
        }

        const { username, password } = request.payload as { username: string; password: string };
        return loginAction(username, password);
      }),
  },
];

export { authRoutes };
