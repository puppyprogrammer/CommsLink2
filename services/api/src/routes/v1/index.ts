import type { Server } from '@hapi/hapi';

import { authRoutes } from './auth';
import { profileRoutes } from './profile';
import { voiceRoutes } from './voice';
import { creditRoutes } from './credits';
import { paymentRoutes } from './payment';
import { adminRoutes } from './admin';
import { versionRoutes } from './version';
import { modelsRoutes } from './models';
import { uploadRoutes } from './upload';
import { terminalRoutes } from './terminal';
import { agentTemplateRoutes } from './agentTemplate';
import { ffxivRoutes } from './ffxiv';
import { gladiatorRoutes } from './gladiator';
import { fightRoutes } from './fight';
import { characterRoutes } from './character';
import { inventoryRoutes } from './inventory';
import { gameUpdateRoutes } from './gameUpdate';
import { shopRoutes } from './shop';
import { armyRoutes } from './army';
import { encounterRoutes } from './encounter';
import { worldRoutes } from './world';
import { worldObjectRoutes } from './worldObjects';
import { worldNpcRoutes } from './worldNpcs';

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
    ...creditRoutes,
    ...paymentRoutes,
    ...adminRoutes,
    ...versionRoutes,
    ...modelsRoutes,
    ...uploadRoutes,
    ...terminalRoutes,
    ...agentTemplateRoutes,
    ...ffxivRoutes,
    ...gladiatorRoutes,
    ...fightRoutes,
    ...characterRoutes,
    ...inventoryRoutes,
    ...gameUpdateRoutes,
    ...shopRoutes,
    ...armyRoutes,
    ...encounterRoutes,
    ...worldRoutes,
    ...worldObjectRoutes,
    ...worldNpcRoutes,
  ]);
};

export { registerRoutes };
