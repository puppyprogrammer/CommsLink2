import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

type ConnectedPlayer = {
  ws: WebSocket;
  userId: string;
  charName: string;
  hearSelf: boolean;
  hearAll: boolean;
  muted: Set<string>;
  heard: Set<string>;
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
          const profile = await Data.ffxivProfile.findByUserId(userId);

          players.set(userId, {
            ws, userId, charName: profile?.char_name || 'Unknown',
            hearSelf: data.hearSelf === true,
            hearAll: true,
            muted: new Set(),
            heard: new Set(),
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

        if (data.type === 'settings' && authenticated) {
          const player = players.get(userId);
          if (player) {
            if (typeof data.hearSelf === 'boolean') player.hearSelf = data.hearSelf;
            if (typeof data.hearAll === 'boolean') player.hearAll = data.hearAll;
            if (Array.isArray(data.muted)) player.muted = new Set(data.muted);
            if (Array.isArray(data.heard)) player.heard = new Set(data.heard);
            ws.send(JSON.stringify({ type: 'settings', status: 'ok', hearSelf: player.hearSelf, hearAll: player.hearAll }));
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
  format: 'wav' | 'mp3' = 'wav',
) => {
  const PROXIMITY_YALMS = 50;
  let sentCount = 0;

  for (const [uid, player] of players) {
    // Skip self unless hearSelf is enabled
    if (uid === senderUserId && !player.hearSelf) continue;
    if (player.ws.readyState !== WebSocket.OPEN) continue;

    // Selective hearing filter
    if (uid !== senderUserId) {
      if (player.hearAll) {
        if (player.muted.has(senderUserId)) continue;
      } else {
        if (!player.heard.has(senderUserId)) continue;
      }
    }

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
      format,
      size: wavBuffer.length,
    }));

    // Send binary WAV frame
    player.ws.send(wavBuffer);
    sentCount++;
  }
  console.log(`[FFXIVoices] Broadcast "${message.substring(0, 30)}" to ${sentCount} player(s), sender=${senderCharName}, hearSelf=${players.get(senderUserId)?.hearSelf}`);
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
