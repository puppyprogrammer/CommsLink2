import tracer from '../../../../../core/lib/tracer';
import creditActions from '../../../../../core/actions/credit';
import Data from '../../../../../core/data';
import { CREDIT_PACKS, SUBSCRIPTION } from '../../../../../core/constants/creditRates';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const creditRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/credits/status',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.CREDITS.STATUS', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return creditActions.getCreditStatus(credentials.id);
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/credits/usage',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.CREDITS.USAGE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return Data.creditUsageLog.findByUser(credentials.id, 50);
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/credits/transactions',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.CREDITS.TRANSACTIONS', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return Data.creditTransaction.findByUser(credentials.id, 50);
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/credits/packs',
    options: { auth: false },
    handler: async () => ({ packs: CREDIT_PACKS, subscription: SUBSCRIPTION }),
  },
];

export { creditRoutes };
