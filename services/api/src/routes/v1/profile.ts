import Joi from 'joi';
import tracer from '../../../../../core/lib/tracer';

import updateProfileAction from '../../../../../core/actions/profile/updateProfileAction';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const profileRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/api/v1/profile/update',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          email: Joi.string().email().optional(),
          password: Joi.string().min(6).max(128).optional(),
          voice_id: Joi.string().optional(),
          volume: Joi.number().min(0).max(1).optional(),
          hear_own_voice: Joi.boolean().optional(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.PROFILE.UPDATE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const payload = request.payload as Record<string, unknown>;
        return updateProfileAction({ userId: credentials.id, ...payload });
      }),
  },
];

export { profileRoutes };
