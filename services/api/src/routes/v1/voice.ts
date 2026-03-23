import Joi from 'joi';
import tracer from '../../../../../core/lib/tracer';

import generatePremiumAudioAction from '../../../../../core/actions/voice/generatePremiumAudioAction';
import listVoicesAction from '../../../../../core/actions/voice/listVoicesAction';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const voiceRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/api/v1/voice/generate',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          text: Joi.string().max(5000).required(),
          voiceId: Joi.string().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.VOICE.GENERATE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { text, voiceId } = request.payload as { text: string; voiceId: string };
        return generatePremiumAudioAction(credentials.id, text, voiceId);
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/voice/list',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.VOICE.LIST', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return listVoicesAction(credentials.id);
      }),
  },
];

export { voiceRoutes };
