import type { ServerRoute } from '@hapi/hapi';

import { AVAILABLE_MODELS } from '../../../../../core/adapters/grok';

const modelsRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/models',
    options: { auth: false },
    handler: () => ({ models: AVAILABLE_MODELS }),
  },
];

export { modelsRoutes };
