import Joi from 'joi';
import tracer from '../../../../../core/lib/tracer';

import updateProfileAction from '../../../../../core/actions/profile/updateProfileAction';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const getClientIp = (request: Request): string => {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const val = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return val.split(',')[0].trim();
  }
  return request.info.remoteAddress;
};

const profileRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/profile/me',
    options: { auth: 'jwt' },
    handler: async (request: Request) => {
      const credentials = request.auth.credentials as unknown as AuthCredentials;
      const user = await Data.user.findById(credentials.id);
      if (!user) return { voice_id: 'Joanna', volume: 1.0, hear_own_voice: false };
      return { voice_id: user.voice_id, volume: user.volume, hear_own_voice: user.hear_own_voice };
    },
  },
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
  {
    method: 'POST',
    path: '/api/v1/profile/delete-account',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          confirmation: Joi.string().valid('DELETE').required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.PROFILE.DELETE_ACCOUNT', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const user = await Data.user.findById(credentials.id);
        if (!user) return h.response({ error: 'User not found' }).code(404);

        // Audit log before deletion
        await Data.auditLog.create({
          event: 'account_deleted',
          username: user.username,
          ip_address: getClientIp(request),
          details: `User ${user.username} (${credentials.id}) deleted their account`,
        });

        await Data.user.deleteAccount(credentials.id);

        return { success: true, message: 'Account and all associated data deleted' };
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/profile/clear-data',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          confirmation: Joi.string().valid('CLEAR').required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.PROFILE.CLEAR_DATA', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const user = await Data.user.findById(credentials.id);
        if (!user) return h.response({ error: 'User not found' }).code(404);

        await Data.auditLog.create({
          event: 'data_cleared',
          username: user.username,
          ip_address: getClientIp(request),
          details: `User ${user.username} cleared their content data (messages, rooms, agents, machines)`,
        });

        await Data.user.clearUserData(credentials.id);

        return { success: true, message: 'Messages, rooms, agents, and machines deleted. Financial records retained.' };
      }),
  },
];

export { profileRoutes };
