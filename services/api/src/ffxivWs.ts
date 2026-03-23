import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

type ConnectedPlayer = {
  ws: WebSocket;
  userId: string;
  charName: string;
  zone: number;
  mapId: number;
  x: number;
  y: number;
  z: number;
};

const players = new Map<string, ConnectedPlayer>();

const init = () => {
  const wss = new WebSocketServer({ port: 8080 });

  wss.on('connection', (ws) => {
    let authenticated = false;
    let userId = '';

    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'auth') {
          // Validate JWT
          const secret = process.env.JWT_SECRET || 'commslink-dev-secret';
          const decoded = jwt.verify(data.token, secret) as { id: string; email: string; type?: string };
          if (decoded.type !== 'ffxiv') { ws.close(); return; }

          userId = decoded.id;
          authenticated = true;

          // Look up user for charName
          const { default: Data } = await import('../../../core/data');
          const user = await Data.ffxivUser.findById(userId);

          players.set(userId, {
            ws, userId, charName: user?.char_name || 'Unknown',
            zone: 0, mapId: 0, x: 0, y: 0, z: 0,
          });

          ws.send(JSON.stringify({ type: 'auth', status: 'ok', userId }));
        }

        if (data.type === 'pos' && authenticated) {
          const player = players.get(userId);
          if (player) {
            player.zone = data.zone || 0;
            player.mapId = data.mapId || 0;
            player.x = data.x || 0;
            player.y = data.y || 0;
            player.z = data.z || 0;
          }
        }
      } catch { /* ignore bad messages */ }
    });

    ws.on('close', () => {
      if (userId) players.delete(userId);
    });
  });

  console.log('[FFXIVoices] WebSocket server running on port 8080');
};

// Distance calculation (3D euclidean)
const distance = (a: ConnectedPlayer, b: { x: number; y: number; z: number }): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

// Broadcast audio to nearby players
const broadcastAudio = (
  senderUserId: string,
  senderCharName: string,
  message: string,
  wavBuffer: Buffer,
  zone: number,
  mapId: number,
  senderPos: { x: number; y: number; z: number },
) => {
  const PROXIMITY_YALMS = 50;

  for (const [uid, player] of players) {
    if (uid === senderUserId) continue; // Don't send to self
    if (player.ws.readyState !== WebSocket.OPEN) continue;

    // Zone + map filter
    if (zone > 0 && player.zone > 0 && player.zone !== zone) continue;
    if (mapId > 0 && player.mapId > 0 && player.mapId !== mapId) continue;

    // Proximity filter (if both have position data)
    if (senderPos.x !== 0 && player.x !== 0) {
      if (distance(player, senderPos) > PROXIMITY_YALMS) continue;
    }

    // Send metadata text frame
    player.ws.send(JSON.stringify({
      type: 'audio',
      playerName: senderCharName,
      message,
      format: 'wav',
      size: wavBuffer.length,
    }));

    // Send binary WAV frame
    player.ws.send(wavBuffer);
  }
};

// Update a player's position (called from chat route)
const updatePlayerPosition = (userId: string, zone: number, mapId: number, x: number, y: number, z: number) => {
  const player = players.get(userId);
  if (player) {
    player.zone = zone;
    player.mapId = mapId;
    player.x = x;
    player.y = y;
    player.z = z;
  }
};

export { init, broadcastAudio, updatePlayerPosition };
