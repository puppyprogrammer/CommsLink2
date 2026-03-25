import 'dotenv/config';

import Hapi from '@hapi/hapi';
import Inert from '@hapi/inert';
import { Server as SocketServer } from 'socket.io';

import registerAuthStrategy from '../../../core/lib/hapi/auth';
import Data from '../../../core/data';

import { registerRoutes } from './routes/v1';
import { registerSocketHandlers } from './handlers/chat';
import { registerGameWorldHandler } from './handlers/gameWorld';

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

  // ┌──────────────────────────────────────────┐
  // │ Game World (Socket.IO /game namespace)   │
  // └──────────────────────────────────────────┘
  const gameNs = io.of('/game');
  registerGameWorldHandler(gameNs);

  return server;
};

export default createServer;
