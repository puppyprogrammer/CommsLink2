import type { ServerRoute } from '@hapi/hapi';

import Data from '../../../../../core/data';

const agentTemplateRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/agent-templates',
    options: { auth: false },
    handler: async () => {
      const templates = await Data.agentTemplate.findAll();
      return { templates };
    },
  },
];

export { agentTemplateRoutes };
