import 'dotenv/config';

import Hapi from '@hapi/hapi';
import Inert from '@hapi/inert';
import { Server as SocketServer } from 'socket.io';

import registerAuthStrategy from '../../../core/lib/hapi/auth';
import Data from '../../../core/data';
import dayjs from '../../../core/lib/dayjs';

import { registerRoutes } from './routes/v1';
import { registerSocketHandlers } from './handlers/chat';

/**
 * Create and configure the Hapi server.
 *
 * @returns Configured Hapi server.
 */
const createServer = async (): Promise<Hapi.Server> => {
  const server = Hapi.server({
    port: process.env.PORT || 4000,
    host: '0.0.0.0',
    routes: {
      cors: {
        origin: process.env.NODE_ENV === 'production'
          ? ['https://commslink.net', 'https://www.commslink.net']
          : ['*'],
        credentials: true,
      },
    },
  });

  // ┌──────────────────────────────────────────┐
  // │ Plugins                                  │
  // └──────────────────────────────────────────┘
  await server.register(Inert);

  // ┌──────────────────────────────────────────┐
  // │ Auth Strategy                            │
  // └──────────────────────────────────────────┘
  await registerAuthStrategy(server);

  // ┌──────────────────────────────────────────┐
  // │ Routes                                   │
  // └──────────────────────────────────────────┘
  registerRoutes(server);

  // Serve uploaded images
  server.route({
    method: 'GET',
    path: '/uploads/{param*}',
    options: { auth: false },
    handler: { directory: { path: '/app/uploads', listing: false } },
  });

  // ┌──────────────────────────────────────────┐
  // │ Visit Tracking                           │
  // └──────────────────────────────────────────┘
  server.ext('onPreHandler', async (request, h) => {
    if (request.path === '/') {
      Data.dailyStats.incrementVisits(dayjs().format('YYYY-MM-DD')).catch(console.error);
    }
    return h.continue;
  });

  // ┌──────────────────────────────────────────┐
  // │ Socket.IO                                │
  // └──────────────────────────────────────────┘
  const io = new SocketServer(server.listener, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? ['https://commslink.net', 'https://www.commslink.net']
        : '*',
      methods: ['GET', 'POST'],
    },
  });

  await registerSocketHandlers(io);

  return server;
};

export default createServer;
