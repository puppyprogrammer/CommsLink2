import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import getDashboardAction from '../../../../../core/actions/admin/getDashboardAction';
import toggleBanAction from '../../../../../core/actions/admin/toggleBanAction';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const requireAdmin = (request: Request): void => {
  const credentials = request.auth.credentials as unknown as AuthCredentials;
  if (!credentials.is_admin) {
    throw Boom.forbidden('Admin access required');
  }
};

const adminRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/admin/dashboard',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.ADMIN.GET_DASHBOARD', async () => {
        requireAdmin(request);
        return getDashboardAction();
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/admin/toggle-ban',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          userId: Joi.string().uuid().required(),
          isBanned: Joi.boolean().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.ADMIN.TOGGLE_BAN', async () => {
        requireAdmin(request);
        const { userId, isBanned } = request.payload as { userId: string; isBanned: boolean };
        return toggleBanAction(userId, isBanned);
      }),
  },
];

export { adminRoutes };
