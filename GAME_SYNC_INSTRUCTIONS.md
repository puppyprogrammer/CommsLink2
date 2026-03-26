# Game Sync WebSocket — CommsLink Implementation Instructions

## Context

The Socket.IO WebSocket for the `/game` namespace keeps disconnecting when the Unity client sends frequent `game:move` events. Instead of fixing Socket.IO, we're adding a dedicated **raw WebSocket** endpoint purely for position/combat sync. No Socket.IO protocol — just raw JSON over WebSocket.

## 1. New Raw WebSocket Endpoint

**URL:** `wss://commslink.net/game-sync?token=JWT_TOKEN`

This is NOT a Socket.IO connection. It's a plain WebSocket using the `ws` library directly, attached to the existing Hapi server or nginx.

### Setup in Hapi

In `services/api/src/index.ts` (or a new handler file), after the Hapi server starts:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { registerGameSyncHandler } from './handlers/gameSync';

// After server.start()
const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP to WebSocket for /game-sync path
server.listener.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  if (url.pathname === '/game-sync') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

registerGameSyncHandler(wss);
```

Note: The `ws` package should already be installed as a dependency of `socket.io`. If not: `yarn add ws @types/ws`.

## 2. Game Sync Handler

Create `services/api/src/handlers/gameSync/index.ts`:

### In-Memory State

```typescript
interface PlayerSyncState {
  userId: string;
  username: string;
  ws: WebSocket;
  pos: [number, number, number];
  rot: number; // Y rotation in degrees
  action: string; // idle, walk, run, attack_light, attack_heavy, block, dodge, hit, dead
  actionStartTime: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  strength: number;
  defense: number;
  lastDamageTime: number;
  isDead: boolean;
}

const players = new Map<string, PlayerSyncState>();
```

### Connection Flow

```typescript
wss.on('connection', async (ws, request) => {
  // 1. Extract token from URL query
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  // 2. Verify JWT
  const decoded = jwtHelper.verifyToken(token);
  if (!decoded) { ws.close(4001, 'Auth failed'); return; }

  // 3. Load character
  const character = await Data.playerCharacter.findByUserId(decoded.id);
  if (!character) { ws.close(4002, 'No character'); return; }

  const userId = decoded.id;
  const username = decoded.username;

  // 4. Create player state
  const state: PlayerSyncState = {
    userId,
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
  };

  players.set(userId, state);
  console.log(`[GameSync] ${username} connected (${players.size} online)`);

  // 5. Send current world state to new player
  const worldState = {
    type: 'world_state',
    players: Array.from(players.values())
      .filter(p => p.userId !== userId)
      .map(p => ({
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

  // 6. Broadcast join to others
  broadcast(userId, { type: 'player_joined', id: userId, username, pos: state.pos, rot: 0, hp: state.hp, maxHp: state.maxHp });

  // 7. Handle messages
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(userId, msg);
    } catch {}
  });

  // 8. Handle disconnect
  ws.on('close', () => {
    players.delete(userId);
    broadcast(userId, { type: 'player_left', id: userId });
    console.log(`[GameSync] ${username} disconnected (${players.size} online)`);
  });
});
```

### Message Types — Client → Server

#### `update` (sent 10/sec by each client)
```json
{
  "type": "update",
  "pos": [x, y, z],
  "rot": 90.5,
  "action": "walk"
}
```

Server:
1. Validate speed (reject teleporting — max 20 units/sec)
2. Update player state
3. Broadcast to all other players (rate limited to 10/sec per player)

#### `attack`
```json
{
  "type": "attack",
  "attackType": "light"
}
```

Server:
1. Validate stamina (light: 10, heavy: 25)
2. Deduct stamina
3. Set action to `attack_light` or `attack_heavy` with timestamp
4. Run hit detection against all nearby players
5. Broadcast attack animation to all: `{ type: "player_action", id, action: "attack_light" }`
6. For each hit, send damage event to all: `{ type: "damage", ... }`

#### `block_start` / `block_end`
```json
{ "type": "block_start" }
{ "type": "block_end" }
```

Server: Update action state, broadcast to all.

#### `dodge`
```json
{
  "type": "dodge",
  "dir": [dx, dz]
}
```

Server: Validate stamina (20), set action to dodge with timestamp (500ms i-frames), broadcast.

### Message Types — Server → Client

#### `world_state` (on join)
```json
{
  "type": "world_state",
  "players": [
    { "id": "uuid", "username": "name", "pos": [x,y,z], "rot": 90, "action": "idle", "hp": 100, "maxHp": 100 }
  ]
}
```

#### `player_joined`
```json
{ "type": "player_joined", "id": "uuid", "username": "name", "pos": [x,y,z], "rot": 0, "hp": 100, "maxHp": 100 }
```

#### `player_left`
```json
{ "type": "player_left", "id": "uuid" }
```

#### `player_update` (broadcast 10/sec per player)
```json
{ "type": "player_update", "id": "uuid", "pos": [x,y,z], "rot": 90, "action": "run" }
```

#### `player_action` (attack/block/dodge animation)
```json
{ "type": "player_action", "id": "uuid", "action": "attack_heavy" }
```

#### `damage` (combat result)
```json
{
  "type": "damage",
  "attacker": "uuid",
  "victim": "uuid",
  "damage": 15,
  "hitType": "light",
  "knockback": [0.5, -0.3],
  "victimHp": 85,
  "victimMaxHp": 100
}
```

Hit types:
- `light` — quick flinch, small knockback (1 unit)
- `heavy` — big stagger, large knockback (2 units), camera shake on victim
- `blocked` — shield recoil, no knockback, reduced damage
- `critical` — hit from behind, extra damage (1.5x), big flinch

#### `player_died`
```json
{ "type": "player_died", "id": "uuid", "killer": "uuid" }
```

#### `player_respawned`
```json
{ "type": "player_respawned", "id": "uuid", "pos": [x,y,z], "hp": 100 }
```

## 3. Combat Resolution

Create `services/api/src/handlers/gameSync/combat.ts`:

```typescript
function resolveAttack(attacker: PlayerSyncState, attackType: 'light' | 'heavy'): void {
  const ATTACK_RANGE = 2.5;
  const LIGHT_DMG = 15;
  const HEAVY_DMG = 30;
  const BLOCK_REDUCTION = 0.8;
  const DODGE_WINDOW = 500; // ms
  const DAMAGE_COOLDOWN = 300; // ms
  const CRITICAL_MULTIPLIER = 1.5;

  const now = Date.now();
  const baseDmg = attackType === 'light' ? LIGHT_DMG : HEAVY_DMG;
  const damage = Math.round(baseDmg * (1 + (attacker.strength - 10) / 100));

  for (const [id, victim] of players) {
    if (id === attacker.userId || victim.isDead) continue;

    // Distance check
    const dx = attacker.pos[0] - victim.pos[0];
    const dz = attacker.pos[2] - victim.pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > ATTACK_RANGE) continue;

    // Facing check — attacker facing victim?
    const attackerRad = attacker.rot * Math.PI / 180;
    const attackerFwd = [Math.sin(attackerRad), Math.cos(attackerRad)];
    const toVictim = [victim.pos[0] - attacker.pos[0], victim.pos[2] - attacker.pos[2]];
    const len = Math.sqrt(toVictim[0] ** 2 + toVictim[1] ** 2);
    if (len < 0.01) continue;
    toVictim[0] /= len;
    toVictim[1] /= len;
    const dot = attackerFwd[0] * toVictim[0] + attackerFwd[1] * toVictim[1];
    if (dot < 0.5) continue; // Not facing

    // Damage cooldown
    if (now - victim.lastDamageTime < DAMAGE_COOLDOWN) continue;

    // Dodge check
    if (victim.action === 'dodge' && (now - victim.actionStartTime) < DODGE_WINDOW) continue;

    // Critical check — hit from behind?
    const victimRad = victim.rot * Math.PI / 180;
    const victimFwd = [Math.sin(victimRad), Math.cos(victimRad)];
    const toAttacker = [-toVictim[0], -toVictim[1]];
    const victimDot = victimFwd[0] * toAttacker[0] + victimFwd[1] * toAttacker[1];
    const isCritical = victimDot < -0.3; // Victim facing away from attacker

    // Block check
    let hitType = attackType === 'heavy' ? 'heavy' : 'light';
    let finalDmg = isCritical ? Math.round(damage * CRITICAL_MULTIPLIER) : damage;

    if (!isCritical && victim.action === 'block' && victimDot > 0.3) {
      hitType = 'blocked';
      finalDmg = Math.round(finalDmg * (1 - BLOCK_REDUCTION));
      const defReduction = victim.defense / 200;
      finalDmg = Math.round(finalDmg * (1 - defReduction));
    }

    if (isCritical) hitType = 'critical';

    // Apply damage
    victim.hp = Math.max(0, victim.hp - finalDmg);
    victim.lastDamageTime = now;

    // Knockback direction (away from attacker)
    const kb = attackType === 'heavy' || isCritical ? 2 : 1;
    const knockback = [toVictim[0] * kb, toVictim[1] * kb];

    // Broadcast damage to ALL players
    const dmgMsg = {
      type: 'damage',
      attacker: attacker.userId,
      victim: id,
      damage: finalDmg,
      hitType,
      knockback,
      victimHp: victim.hp,
      victimMaxHp: victim.maxHp,
    };
    broadcastAll(dmgMsg);

    // Check death
    if (victim.hp <= 0) {
      victim.isDead = true;
      victim.action = 'dead';
      broadcastAll({ type: 'player_died', id, killer: attacker.userId });

      // Record kill/death in DB
      Data.playerCharacter.recordKill(attacker.characterId).catch(() => {});
      Data.playerCharacter.recordDeath(victim.characterId).catch(() => {});
      Data.playerCharacter.addXP(attacker.characterId, 50).catch(() => {});

      // Respawn after 5 seconds
      setTimeout(() => {
        if (!players.has(id)) return;
        victim.isDead = false;
        victim.hp = victim.maxHp;
        victim.stamina = victim.maxStamina;
        victim.action = 'idle';
        victim.pos = [victim.spawnX ?? 2, victim.spawnY ?? 0.5, victim.spawnZ ?? -2];
        broadcastAll({ type: 'player_respawned', id, pos: victim.pos, hp: victim.hp });
      }, 5000);
    }
  }
}
```

## 4. Stamina Regeneration

```typescript
setInterval(() => {
  for (const [, p] of players) {
    if (p.isDead) continue;
    if (p.stamina < p.maxStamina && p.action !== 'block') {
      p.stamina = Math.min(p.maxStamina, p.stamina + 1);
    }
  }
}, 200);
```

## 5. Broadcast Helpers

```typescript
function broadcast(excludeUserId: string, msg: object) {
  const json = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== excludeUserId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(json);
    }
  }
}

function broadcastAll(msg: object) {
  const json = JSON.stringify(msg);
  for (const [, p] of players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(json);
    }
  }
}
```

## 6. Nginx Config

Add to the commslink.net nginx server block:

```nginx
location /game-sync {
    proxy_pass http://localhost:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

## 7. HandleMessage

```typescript
function handleMessage(userId: string, msg: any) {
  const player = players.get(userId);
  if (!player || player.isDead) return;

  switch (msg.type) {
    case 'update': {
      // Speed validation
      const now = Date.now();
      if (msg.pos && Array.isArray(msg.pos) && msg.pos.length === 3) {
        player.pos = msg.pos;
      }
      if (typeof msg.rot === 'number') player.rot = msg.rot;
      if (msg.action === 'idle' || msg.action === 'walk' || msg.action === 'run') {
        player.action = msg.action;
      }
      // Broadcast to others
      broadcast(userId, {
        type: 'player_update',
        id: userId,
        pos: player.pos,
        rot: player.rot,
        action: player.action,
      });
      break;
    }

    case 'attack': {
      const attackType = msg.attackType === 'heavy' ? 'heavy' : 'light';
      const staminaCost = attackType === 'heavy' ? 25 : 10;
      if (player.stamina < staminaCost) return;
      player.stamina -= staminaCost;
      player.action = attackType === 'heavy' ? 'attack_heavy' : 'attack_light';
      player.actionStartTime = Date.now();
      broadcast(userId, { type: 'player_action', id: userId, action: player.action });
      resolveAttack(player, attackType);
      break;
    }

    case 'block_start':
      player.action = 'block';
      player.actionStartTime = Date.now();
      broadcast(userId, { type: 'player_action', id: userId, action: 'block' });
      break;

    case 'block_end':
      player.action = 'idle';
      broadcast(userId, { type: 'player_action', id: userId, action: 'idle' });
      break;

    case 'dodge': {
      if (player.stamina < 20) return;
      player.stamina -= 20;
      player.action = 'dodge';
      player.actionStartTime = Date.now();
      broadcast(userId, { type: 'player_action', id: userId, action: 'dodge' });
      // Reset dodge after 500ms
      setTimeout(() => {
        if (player.action === 'dodge') player.action = 'idle';
      }, 500);
      break;
    }
  }
}
```

## 8. Deploy

```bash
# May need to install ws if not already present
# yarn add ws @types/ws  (probably already there from socket.io)

bash scripts/deploy.sh api "Add raw WebSocket game-sync endpoint for position and combat"
```

Then update nginx config on EC2 to add the `/game-sync` location block.
