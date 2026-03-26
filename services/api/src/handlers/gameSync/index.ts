import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

import jwtHelper from '../../../../../core/helpers/jwt';
import Data from '../../../../../core/data';

import { players, handleMessage, loadWeaponRange } from './combat';
import type { PlayerSyncState } from './combat';
import { registerPlayerNPCs, unregisterPlayerNPCs } from './ai/npcEngine';

// ┌──────────────────────────────────────────┐
// │ Stamina Regeneration (5/sec)             │
// └──────────────────────────────────────────┘

setInterval(() => {
  for (const [, p] of players) {
    if (p.isDead) continue;
    if (p.stamina < p.maxStamina && p.action !== 'block') {
      p.stamina = Math.min(p.maxStamina, p.stamina + 1);
    }
  }
}, 200);

// ┌──────────────────────────────────────────┐
// │ Game Sync WebSocket Handler              │
// └──────────────────────────────────────────┘

const registerGameSyncHandler = (wss: WebSocketServer): void => {
  console.log('[GameSync] Raw WebSocket handler registered');

  wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) { ws.close(4001, 'No token'); return; }

      const decoded = jwtHelper.verifyToken(token);
      if (!decoded) { ws.close(4001, 'Auth failed'); return; }

      const character = await Data.playerCharacter.findByUserId(decoded.id);
      if (!character) { ws.close(4002, 'No character'); return; }

      const userId = decoded.id;
      const username = decoded.username;

      // Load weapon range from equipped items — server-authoritative
      const weapon = await loadWeaponRange(character.id);

      const state: PlayerSyncState = {
        userId,
        characterId: character.id,
        username,
        ws,
        pos: [character.spawn_x, character.spawn_y, character.spawn_z],
        rot: 0,
        action: 'idle',
        actionStartTime: Date.now(),
        hp: character.max_health,
        maxHp: character.max_health,
        stamina: character.max_stamina,
        maxStamina: character.max_stamina,
        strength: character.strength,
        defense: character.defense,
        lastDamageTime: 0,
        isDead: false,
        spawnX: character.spawn_x,
        spawnY: character.spawn_y,
        spawnZ: character.spawn_z,
        weaponRange: weapon.range,
        weaponName: weapon.name,
      };

      players.set(userId, state);
      console.log(`[GameSync] ${username} connected (${players.size} online)`);

      // Send world state (all current players + NPCs)
      const worldState = {
        type: 'world_state',
        players: Array.from(players.values())
          .filter((p) => p.userId !== userId)
          .map((p) => ({
            id: p.userId,
            username: p.username,
            pos: p.pos,
            rot: p.rot,
            action: p.action,
            hp: p.hp,
            maxHp: p.maxHp,
          })),
      };
      ws.send(JSON.stringify(worldState));

      // Broadcast join to others
      const joinMsg = JSON.stringify({
        type: 'player_joined',
        id: userId,
        username,
        pos: state.pos,
        rot: 0,
        hp: state.hp,
        maxHp: state.maxHp,
      });
      for (const [id, p] of players) {
        if (id !== userId && p.ws?.readyState === WebSocket.OPEN) {
          p.ws.send(joinMsg);
        }
      }

      // Auto-register this player's NPC recruits
      registerPlayerNPCs(userId).catch((err) => {
        console.error(`[GameSync] Failed to register NPCs for ${username}:`, err);
      });

      // Handle messages
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Handle register_npcs explicitly (in case client sends it)
          if (msg.type === 'register_npcs') {
            registerPlayerNPCs(userId).catch(console.error);
            return;
          }

          handleMessage(userId, msg);
        } catch { /* ignore bad messages */ }
      });

      // Handle disconnect
      ws.on('close', () => {
        const player = players.get(userId);
        if (player) {
          Data.playerCharacter.updateSpawn(
            player.characterId,
            player.pos[0], player.pos[1], player.pos[2],
          ).catch(console.error);
        }

        players.delete(userId);

        // Unregister this player's NPCs
        unregisterPlayerNPCs(userId);

        const leftMsg = JSON.stringify({ type: 'player_left', id: userId });
        for (const [, p] of players) {
          if (p.ws?.readyState === WebSocket.OPEN) p.ws.send(leftMsg);
        }
        console.log(`[GameSync] ${username} disconnected (${players.size} online)`);
      });

    } catch (err) {
      console.error('[GameSync] Connection error:', err);
      ws.close(4000, 'Server error');
    }
  });
};

export { registerGameSyncHandler };
