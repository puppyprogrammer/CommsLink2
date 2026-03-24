import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import handleWebhookAction from '../../../../../core/actions/payment/handleWebhookAction';
import stripeAdapter from '../../../../../core/adapters/stripe';
import Data from '../../../../../core/data';
import { CREDIT_PACKS } from '../../../../../core/constants/creditRates';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const paymentRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/api/v1/payment/buy-credits',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          packId: Joi.string().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.PAYMENT.BUY_CREDITS', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { packId } = request.payload as { packId: string };

        const pack = CREDIT_PACKS.find((p) => p.id === packId);
        if (!pack) throw Boom.badRequest('Invalid credit pack');

        const user = await Data.user.findById(credentials.id);
        if (!user) throw Boom.notFound('User not found');

        const session = await stripeAdapter.createTopUpCheckout(
          credentials.id,
          user.email || `${credentials.username}@commslink.local`,
          credentials.username,
          pack.id,
          pack.priceUsd,
          pack.credits,
        );

        return { url: session.url };
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/payment/webhook',
    options: {
      auth: false,
      payload: {
        parse: false,
        output: 'data',
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.PAYMENT.WEBHOOK', async () => {
        const signature = request.headers['stripe-signature'] as string;
        const event = stripeAdapter.constructWebhookEvent(
          request.payload as Buffer,
          signature,
        );
        await handleWebhookAction(event);
        return { received: true };
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/payment/status',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.PAYMENT.GET_STATUS', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const user = await Data.user.findById(credentials.id);

        return {
          creditBalance: user?.credit_balance ?? 0,
        };
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/payment/transactions',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.PAYMENT.GET_TRANSACTIONS', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return Data.paymentTransaction.findByUser(credentials.id, 50);
      }),
  },
];

export { paymentRoutes };
