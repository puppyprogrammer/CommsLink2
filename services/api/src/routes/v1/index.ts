import type { Server } from '@hapi/hapi';

import { authRoutes } from './auth';
import { profileRoutes } from './profile';
import { voiceRoutes } from './voice';
import { adminRoutes } from './admin';
import { versionRoutes } from './version';
import { modelsRoutes } from './models';
import { uploadRoutes } from './upload';
import { terminalRoutes } from './terminal';
import { agentTemplateRoutes } from './agentTemplate';

/**
 * Register all v1 API routes.
 *
 * @param server - Hapi server instance.
 */
const registerRoutes = (server: Server): void => {
  server.route([
    ...authRoutes,
    ...profileRoutes,
    ...voiceRoutes,
    ...adminRoutes,
    ...versionRoutes,
    ...modelsRoutes,
    ...uploadRoutes,
    ...terminalRoutes,
    ...agentTemplateRoutes,
  ]);
};

export { registerRoutes };
