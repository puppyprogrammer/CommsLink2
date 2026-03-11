import type { Server } from '@hapi/hapi';

import { authRoutes } from './auth';
import { profileRoutes } from './profile';
import { paymentRoutes } from './payment';
import { voiceRoutes } from './voice';
import { forumRoutes } from './forum';
import { adminRoutes } from './admin';
import { versionRoutes } from './version';
import { modelsRoutes } from './models';
import { creditRoutes } from './credits';
import { uploadRoutes } from './upload';
import { terminalRoutes } from './terminal';

/**
 * Register all v1 API routes.
 *
 * @param server - Hapi server instance.
 */
const registerRoutes = (server: Server): void => {
  server.route([
    ...authRoutes,
    ...profileRoutes,
    ...paymentRoutes,
    ...voiceRoutes,
    ...forumRoutes,
    ...adminRoutes,
    ...versionRoutes,
    ...modelsRoutes,
    ...creditRoutes,
    ...uploadRoutes,
    ...terminalRoutes,
  ]);
};

export { registerRoutes };
