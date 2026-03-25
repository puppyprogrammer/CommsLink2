import type { Namespace, Socket } from 'socket.io';

import jwtHelper from '../../../../../core/helpers/jwt';
import Data from '../../../../../core/data';
import addXPAction from '../../../../../core/actions/character/addXPAction';

import {
  resolveAttack,
  LIGHT_STAMINA, HEAVY_STAMINA, DODGE_STAMINA,
  LIGHT_ATTACK_MS, HEAVY_ATTACK_MS,
  RESPAWN_DELAY_MS, STAMINA_REGEN_TICK_MS,
  MAX_SPEED_PER_SEC, BROADCAST_INTERVAL_MS, XP_PER_KILL,
} from './combat';
import type { PlayerState, Vec3 } from './combat';

// ┌──────────────────────────────────────────┐
// │ In-Memory Game State                     │
// └──────────────────────────────────────────┘

const players = new Map<string, PlayerState>();
const lastBroadcast = new Map<string, number>();

type AuthenticatedSocket = Socket & { user: { id: string; username: string } };

// ── Helpers ──

const shouldBroadcast = (userId: string): boolean => {
  const now = Date.now();
  const last = lastBroadcast.get(userId) || 0;
  if (now - last >= BROADCAST_INTERVAL_MS) {
    lastBroadcast.set(userId, now);
    return true;
  }
  return false;
};

const serializePlayer = (p: PlayerState) => ({
  userId: p.userId,
  username: p.username,
  position: p.position,
  rotation: p.rotation,
  health: p.health,
  maxHealth: p.maxHealth,
  stamina: p.stamina,
  maxStamina: p.maxStamina,
  action: p.action,
  isDead: p.isDead,
});

// ┌──────────────────────────────────────────┐
// │ Stamina Regeneration Tick                │
// └──────────────────────────────────────────┘

setInterval(() => {
  for (const [, player] of players) {
    if (player.isDead) continue;
    if (player.stamina < player.maxStamina && player.action !== 'block') {
      player.stamina = Math.min(player.maxStamina, player.stamina + 1);
    }
  }
}, STAMINA_REGEN_TICK_MS);

// ┌──────────────────────────────────────────┐
// │ Game World Handler                       │
// └──────────────────────────────────────────┘

const registerGameWorldHandler = (gameNs: Namespace): void => {
  console.log('[GameWorld] Registering /game namespace');

  // ── Auth Middleware ──
  gameNs.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication error'));

    const decoded = jwtHelper.verifyToken(token);
    if (!decoded) return next(new Error('Authentication error'));

    const user = await Data.user.findById(decoded.id);
    if (!user) return next(new Error('Authentication error'));
    if (user.is_banned) return next(new Error('Account banned'));

    (socket as AuthenticatedSocket).user = { id: decoded.id, username: user.username };
    next();
  });

  // ── Connection Handler ──
  gameNs.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const { id: userId, username } = socket.user;

    console.log(`[GameWorld] Connected: ${username} (${socket.id})`);

    // ── game:join ──
    socket.on('game:join', async () => {
      try {
        const character = await Data.playerCharacter.findByUserId(userId);
        if (!character) {
          socket.emit('game:error', { message: 'No character found. Create one first.' });
          return;
        }

        // Auto-add to global-game chat room if not already a member
        const globalRoom = await Data.room.findByName('global-game');
        if (globalRoom) {
          const membership = await Data.roomMember.findByRoomAndUser(globalRoom.id, userId);
          if (!membership) {
            await Data.roomMember.addMember(globalRoom.id, userId, 'member');
          }
        }

        const playerState: PlayerState = {
          userId,
          characterId: character.id,
          username,
          socketId: socket.id,
          position: { x: character.spawn_x, y: character.spawn_y, z: character.spawn_z },
          rotation: { x: 0, y: 0, z: 0 },
          health: character.max_health,
          maxHealth: character.max_health,
          stamina: character.max_stamina,
          maxStamina: character.max_stamina,
          strength: character.strength,
          defense: character.defense,
          speed: character.speed,
          action: 'idle',
          actionTimestamp: 0,
          lastDamageTime: 0,
          lastMoveTime: Date.now(),
          isDead: false,
          spawnX: character.spawn_x,
          spawnY: character.spawn_y,
          spawnZ: character.spawn_z,
        };

        players.set(userId, playerState);

        // Send current world state to joining player
        const allPlayers = Array.from(players.values()).map(serializePlayer);
        socket.emit('game:world_state', { players: allPlayers });

        // Broadcast to others
        socket.broadcast.emit('game:player_joined', serializePlayer(playerState));

        console.log(`[GameWorld] ${username} joined (${players.size} players online)`);
      } catch (err) {
        console.error(`[GameWorld] Join error for ${username}:`, err);
        socket.emit('game:error', { message: 'Failed to join game world' });
      }
    });

    // ── game:move ──
    socket.on('game:move', (data: { position: Vec3; rotation: Vec3; action: string }) => {
      const player = players.get(userId);
      if (!player || player.isDead) return;

      // Basic speed validation
      const now = Date.now();
      const dt = (now - player.lastMoveTime) / 1000;
      if (dt > 0.01) {
        const dx = data.position.x - player.position.x;
        const dy = data.position.y - player.position.y;
        const dz = data.position.z - player.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const speed = dist / dt;
        if (speed > MAX_SPEED_PER_SEC) return; // reject teleporting
      }

      player.position = data.position;
      player.rotation = data.rotation;
      player.lastMoveTime = now;
      if (data.action === 'idle' || data.action === 'walk' || data.action === 'run') {
        player.action = data.action;
      }

      // Rate-limited broadcast
      if (shouldBroadcast(userId)) {
        socket.broadcast.emit('game:player_moved', {
          userId,
          position: player.position,
          rotation: player.rotation,
          action: player.action,
        });
      }
    });

    // ── game:attack ──
    socket.on('game:attack', (data: { attackType: 'light' | 'heavy'; position: Vec3; rotation: Vec3 }) => {
      const player = players.get(userId);
      if (!player || player.isDead) return;

      const now = Date.now();

      // Check if still in attack animation
      const attackDuration = player.action === 'attack_light' ? LIGHT_ATTACK_MS : HEAVY_ATTACK_MS;
      if ((player.action === 'attack_light' || player.action === 'attack_heavy') &&
          (now - player.actionTimestamp) < attackDuration) {
        return; // still attacking
      }

      // Stamina check
      const staminaCost = data.attackType === 'light' ? LIGHT_STAMINA : HEAVY_STAMINA;
      if (player.stamina < staminaCost) return;

      // Execute attack
      player.stamina -= staminaCost;
      player.position = data.position;
      player.rotation = data.rotation;
      player.action = data.attackType === 'light' ? 'attack_light' : 'attack_heavy';
      player.actionTimestamp = now;

      // Broadcast attack animation
      gameNs.emit('game:player_attacked', {
        userId,
        attackType: data.attackType,
        position: player.position,
        rotation: player.rotation,
      });

      // Resolve hits
      const results = resolveAttack(player, data.attackType, players);

      for (const result of results) {
        // Broadcast damage to all
        gameNs.emit('game:damage', result);

        if (result.wasKill) {
          gameNs.emit('game:player_died', { userId: result.victimId, killerId: result.attackerId });

          // DB updates (fire and forget)
          Data.playerCharacter.recordKill(player.characterId).catch(console.error);
          Data.playerCharacter.recordDeath(players.get(result.victimId)!.characterId).catch(console.error);
          addXPAction(player.characterId, XP_PER_KILL).catch(console.error);

          // Schedule respawn
          const victim = players.get(result.victimId);
          if (victim) {
            setTimeout(() => {
              if (!victim.isDead) return;
              victim.isDead = false;
              victim.health = victim.maxHealth;
              victim.stamina = victim.maxStamina;
              victim.action = 'idle';
              victim.position = { x: victim.spawnX, y: victim.spawnY, z: victim.spawnZ };

              gameNs.emit('game:player_respawned', {
                userId: victim.userId,
                position: victim.position,
                health: victim.health,
              });
            }, RESPAWN_DELAY_MS);
          }
        }
      }
    });

    // ── game:block_start ──
    socket.on('game:block_start', (data: { position: Vec3; rotation: Vec3 }) => {
      const player = players.get(userId);
      if (!player || player.isDead) return;

      player.position = data.position;
      player.rotation = data.rotation;
      player.action = 'block';
      player.actionTimestamp = Date.now();

      socket.broadcast.emit('game:player_block_start', { userId, position: player.position, rotation: player.rotation });
    });

    // ── game:block_end ──
    socket.on('game:block_end', () => {
      const player = players.get(userId);
      if (!player || player.isDead) return;

      player.action = 'idle';
      socket.broadcast.emit('game:player_block_end', { userId });
    });

    // ── game:dodge ──
    socket.on('game:dodge', (data: { position: Vec3; rotation: Vec3; direction: { x: number; z: number } }) => {
      const player = players.get(userId);
      if (!player || player.isDead) return;

      if (player.stamina < DODGE_STAMINA) return;

      player.stamina -= DODGE_STAMINA;
      player.position = data.position;
      player.rotation = data.rotation;
      player.action = 'dodge';
      player.actionTimestamp = Date.now();

      socket.broadcast.emit('game:player_dodged', {
        userId,
        position: player.position,
        rotation: player.rotation,
        direction: data.direction,
      });
    });

    // ── Disconnect ──
    socket.on('disconnect', () => {
      const player = players.get(userId);
      if (player) {
        // Save position to DB
        Data.playerCharacter.updateSpawn(
          player.characterId,
          player.position.x, player.position.y, player.position.z,
        ).catch(console.error);

        players.delete(userId);
        lastBroadcast.delete(userId);

        gameNs.emit('game:player_left', { userId });
        console.log(`[GameWorld] ${username} left (${players.size} players online)`);
      }
    });
  });
};

export { registerGameWorldHandler, players };
