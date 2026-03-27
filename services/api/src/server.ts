import 'dotenv/config';

import Hapi from '@hapi/hapi';
import Inert from '@hapi/inert';
import { Server as SocketServer } from 'socket.io';

import registerAuthStrategy from '../../../core/lib/hapi/auth';
import Data from '../../../core/data';

import { registerRoutes } from './routes/v1';
import { registerSocketHandlers } from './handlers/chat';
// GameWorld disabled — GameSync is the single authoritative game system
// import { registerGameWorldHandler } from './handlers/gameWorld';
import { WebSocketServer } from 'ws';
import { registerGameSyncHandler } from './handlers/gameSync';

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
    pingTimeout: 20000,    // Wait 20s for pong before disconnecting (fast drop detection)
    pingInterval: 10000,   // Send ping every 10s (frequent keepalive for high-latency clients)
  });

  await registerSocketHandlers(io);

  // GameWorld (/game namespace) disabled — was duplicating player state with GameSync,
  // causing ghost clones. GameSync handles all game logic (NPCs, combat, formations, vegetation).

  // ┌──────────────────────────────────────────┐
  // │ Game Sync (Raw WebSocket on /game-sync)  │
  // └──────────────────────────────────────────┘
  const gameSyncWss = new WebSocketServer({ noServer: true });
  server.listener.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === '/game-sync') {
      gameSyncWss.handleUpgrade(request, socket, head, (ws) => {
        gameSyncWss.emit('connection', ws, request);
      });
    }
  });
  registerGameSyncHandler(gameSyncWss);

  return server;
};

export default createServer;
