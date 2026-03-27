import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

import jwtHelper from '../../../../../core/helpers/jwt';
import Data from '../../../../../core/data';

import { players, handleMessage, loadEquipment } from './combat';
import type { PlayerSyncState } from './combat';
import { registerPlayerNPCs, unregisterPlayerNPCs, activeNPCs } from './ai/npcEngine';
import { initVegetationSystem, checkTrampling } from './vegetation';
import { initCritterSystem } from './critters';
import { setRelationCache, getRelation } from './ai/behaviorTree';

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

  // Initialize vegetation & world time system
  initVegetationSystem();

  // Initialize critter/wildlife system
  initCritterSystem().catch((err) => console.error('[Critters] Init error:', err));

  // Load player relations into in-memory cache
  (async () => {
    try {
      const prisma = (await import('../../../../../core/adapters/prisma')).default;
      const allRelations = await prisma.player_relation.findMany();
      for (const r of allRelations) {
        setRelationCache(r.user_id, r.target_id, r.relation);
      }
      console.log(`[Relations] Loaded ${allRelations.length} relations into cache`);
    } catch (err) {
      console.error('[Relations] Failed to load cache:', err);
    }
  })();

  // Track missed pongs — terminate after 3 consecutive misses (30s with no response)
  const missedPongs = new Map<WebSocket, number>();

  // Ping every 10s — fast keepalive for high-latency international connections
  setInterval(() => {
    for (const [id, p] of players) {
      if (!p.ws || p.ws.readyState !== WebSocket.OPEN) continue;
      const missed = (missedPongs.get(p.ws) || 0) + 1;
      if (missed >= 3) {
        console.log(`[GameSync] ${p.username} missed 3 pongs — terminating`);
        missedPongs.delete(p.ws);
        p.ws.terminate();
        continue;
      }
      missedPongs.set(p.ws, missed);
      p.ws.ping();
    }
  }, 10000);

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

      // Load equipped items — server-authoritative
      const gear = await loadEquipment(character.id);

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
        weaponRange: gear.range,
        weaponName: gear.name,
        equipped: gear.equipped,
      };

      players.set(userId, state);
      missedPongs.set(ws, 0); // Start fresh
      ws.on('pong', () => missedPongs.set(ws, 0));
      console.log(`[GameSync] ${username} connected (${players.size} online)`);

      // Send world state (all current players + NPCs)
      const worldState = {
        type: 'world_state',
        players: Array.from(players.values())
          .filter((p) => p.userId !== userId)
          .map((p) => {
            // For NPCs, the relation is based on their commander, not the NPC itself
            const npcBrain = activeNPCs.get(p.userId);
            const effectiveId = npcBrain ? npcBrain.commanderUserId : p.userId;
            const relation = effectiveId.startsWith('encounter-') ? 'enemy' : getRelation(userId, effectiveId);
            return {
              id: p.userId,
              username: p.username,
              pos: p.pos,
              rot: p.rot,
              action: p.action,
              hp: p.hp,
              maxHp: p.maxHp,
              isNpc: !!npcBrain,
              equipped: p.equipped || [],
              relation,
              commanderId: npcBrain?.commanderUserId || null,
            };
          }),
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
        equipped: state.equipped,
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
        missedPongs.delete(ws);
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
