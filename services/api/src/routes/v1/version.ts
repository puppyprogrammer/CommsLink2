import tracer from '../../../../../core/lib/tracer';

import getVersionsAction from '../../../../../core/actions/version/getVersionsAction';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

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
];

export { versionRoutes };
