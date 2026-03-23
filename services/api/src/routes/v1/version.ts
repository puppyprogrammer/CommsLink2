import tracer from '../../../../../core/lib/tracer';

import getVersionsAction from '../../../../../core/actions/version/getVersionsAction';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

// Cache stats for 5 minutes
let statsCache: { data: Record<string, number>; ts: number } | null = null;

const versionRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/versions',
    options: { auth: false },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.VERSION.GET_VERSIONS', async () => {
        return getVersionsAction();
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/stats',
    options: { auth: false },
    handler: async () => {
      const now = Date.now();
      if (statsCache && now - statsCache.ts < 300_000) return statsCache.data;

      const [users, rooms, agents] = await Promise.all([
        Data.user.findAll().then((u) => u.length),
        Data.room.findAll().then((r) => r.length),
        Data.llmAgent.countAll ? Data.llmAgent.countAll() : Promise.resolve(0),
      ]);

      const data = { users, rooms, agents };
      statsCache = { data, ts: now };
      return data;
    },
  },
];

export { versionRoutes };
