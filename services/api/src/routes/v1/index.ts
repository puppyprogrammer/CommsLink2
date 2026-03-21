import type { Server } from '@hapi/hapi';

import { authRoutes } from './auth';
import { profileRoutes } from './profile';
import { voiceRoutes } from './voice';
import { forumRoutes } from './forum';
import { adminRoutes } from './admin';
import { versionRoutes } from './version';
import { modelsRoutes } from './models';
import { uploadRoutes } from './upload';
import { terminalRoutes } from './terminal';
import { watchlistRoutes } from './watchlist';
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
    ...forumRoutes,
    ...adminRoutes,
    ...versionRoutes,
    ...modelsRoutes,
    ...uploadRoutes,
    ...terminalRoutes,
    ...watchlistRoutes,
    ...agentTemplateRoutes,
  ]);
};

export { registerRoutes };
