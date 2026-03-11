'use client';

// Node modules
import { io, Socket } from 'socket.io-client';

// Libraries
import config from '@/settings/config.json';

let socket: Socket | null = null;

const getSocket = (token?: string): Socket => {
  if (!socket) {
    socket = io(config.WS_HOSTNAME, {
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return socket;
};

const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export { getSocket, disconnectSocket };
export default getSocket;
