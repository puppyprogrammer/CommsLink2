import tracer from '../../../../../core/lib/tracer';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const watchlistRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/watchlist',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.WATCHLIST.LIST', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const status = (request.query as Record<string, string>).status as 'WATCHED' | 'UNWATCHED' | undefined;
        return Data.watchlistItem.findByUser(credentials.id, status);
      }),
  },
];

export { watchlistRoutes };
