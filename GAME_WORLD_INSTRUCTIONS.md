# Game World — CommsLink Implementation Instructions

## Context

We are building real-time multiplayer PvP combat for a medieval MMO game called "AI Fight Club". The Unity client connects to CommsLink via Socket.IO for real-time position sync and combat. CommsLink is the authoritative server — it validates all hits, resolves combat, and broadcasts state to clients.

The Unity client already has:
- Player controller (WASD movement, third-person camera)
- Synty Polygon Knights character models
- Mixamo animations (idle, walk, run, sword attacks, blocks, dodge, death, hit reactions)
- Login/register UI connected to CommsLink auth endpoints
- Socket.IO client will connect after login

## 1. New Prisma Table: `player_character`

Add to `prisma/schema.prisma`:

```prisma
model player_character {
  id         String   @id @default(uuid())
  user_id    String   @unique
  name       String
  level      Int      @default(1)
  xp         Int      @default(0)
  max_health Int      @default(100)
  max_stamina Int     @default(100)
  strength   Int      @default(10)
  defense    Int      @default(10)
  speed      Int      @default(10)
  kills      Int      @default(0)
  deaths     Int      @default(0)
  spawn_x    Float    @default(2)
  spawn_y    Float    @default(0.5)
  spawn_z    Float    @default(-2)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  user user @relation(fields: [user_id], references: [id])

  @@index([user_id])
}
```

Add `player_characters player_character?` to the `user` model's relations.

## 2. New Data Module: `core/data/playerCharacter/index.ts`

Follow existing pattern (see `core/data/llmAgent/index.ts` for reference).

Functions needed:
- `create(data: { user_id, name })` — creates with default stats
- `findById(id)` — get by character ID
- `findByUserId(userId)` — get by user ID (main lookup)
- `update(id, data)` — update stats
- `addXP(id, amount)` — increment XP, handle level ups
- `recordKill(id)` — increment kills
- `recordDeath(id)` — increment deaths
- `updateSpawn(id, x, y, z)` — save last position as spawn point

Register in `core/data/index.ts` as `playerCharacter`.

## 3. New Actions

### `core/actions/character/createCharacterAction.ts`
- Takes `userId`, `name`
- Validates: user doesn't already have a character, name is 2-20 chars
- Creates player_character with defaults
- Returns the created character

### `core/actions/character/getCharacterAction.ts`
- Takes `userId`
- Returns player_character or throws 404

## 4. New Routes

### `services/api/src/routes/v1/character.ts`

```
POST /api/v1/characters          — create character (auth required)
  body: { name: string }
  returns: player_character object

GET  /api/v1/characters/me       — get my character (auth required)
  returns: player_character object

GET  /api/v1/characters/:id      — get character by ID (auth required)
  returns: player_character object
```

Register in `services/api/src/routes/v1/index.ts`.

## 5. Socket.IO Game World Handler

This is the big one. Create a new file:

### `services/api/src/handlers/gameWorld/index.ts`

This handler manages the real-time game world. It should be registered alongside the existing chat handler in the server setup.

### In-Memory State

```typescript
// Player state — stored in memory, NOT in database
interface PlayerState {
  userId: string;
  characterId: string;
  username: string;
  socketId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  action: 'idle' | 'walk' | 'run' | 'attack_light' | 'attack_heavy' | 'block' | 'dodge' | 'hit' | 'dead';
  actionTimestamp: number;  // when current action started (ms)
  lastDamageTime: number;   // for damage cooldown
  isDead: boolean;
}

// Store all connected players
const players: Map<string, PlayerState> = new Map();
```

### Socket Events — Client → Server

#### `game:join`
Client sends after login + character creation.
```typescript
payload: { token: string }  // JWT token for auth
```
Server:
1. Verify JWT token
2. Load player_character from DB
3. Create PlayerState in memory with full health/stamina
4. Add to `players` map
5. Broadcast `game:player_joined` to all other players
6. Send `game:world_state` back to joining player (all current player positions)

#### `game:move`
Client sends every 100ms while moving.
```typescript
payload: {
  position: { x: number, y: number, z: number },
  rotation: { x: number, y: number, z: number },
  action: 'idle' | 'walk' | 'run'
}
```
Server:
1. Validate player exists in `players` map
2. Basic speed validation (reject teleporting — max 15 units/sec)
3. Update player state
4. Broadcast `game:player_moved` to all other players

#### `game:attack`
Client sends when player clicks attack.
```typescript
payload: {
  attackType: 'light' | 'heavy',
  position: { x: number, y: number, z: number },
  rotation: { x: number, y: number, z: number }
}
```
Server:
1. Validate player is alive, not already attacking, has enough stamina
2. Deduct stamina (light: 10, heavy: 25)
3. Set player action to `attack_light` or `attack_heavy` with timestamp
4. Run hit detection (see Combat Resolution below)
5. Broadcast `game:player_attacked` to all players (so they see the animation)
6. If hit landed, send `game:damage` to the victim

#### `game:block_start`
```typescript
payload: { position, rotation }
```
Server: Set player action to `block`, broadcast `game:player_block_start`

#### `game:block_end`
Server: Set player action to `idle`, broadcast `game:player_block_end`

#### `game:dodge`
```typescript
payload: { position, rotation, direction: { x, z } }
```
Server:
1. Validate has stamina (cost: 20)
2. Set action to `dodge` with timestamp (dodge lasts 500ms — i-frames)
3. Broadcast `game:player_dodged`

#### `game:leave` / disconnect
Server:
1. Save player position to DB (updateSpawn)
2. Remove from `players` map
3. Broadcast `game:player_left`

### Socket Events — Server → Client

#### `game:world_state`
Sent to a player when they join. Contains all current players.
```typescript
{
  players: Array<{
    userId: string,
    username: string,
    position: { x, y, z },
    rotation: { x, y, z },
    health: number,
    maxHealth: number,
    action: string,
    isDead: boolean
  }>
}
```

#### `game:player_joined`
Broadcast when a new player joins.
```typescript
{ userId, username, position, rotation, health, maxHealth }
```

#### `game:player_left`
```typescript
{ userId }
```

#### `game:player_moved`
Broadcast at rate-limited intervals (max 10/sec per player).
```typescript
{ userId, position, rotation, action }
```

#### `game:player_attacked`
```typescript
{ userId, attackType, position, rotation }
```

#### `game:damage`
Sent to ALL players (so they can show hit effects).
```typescript
{
  attackerId: string,
  victimId: string,
  damage: number,
  victimHealthAfter: number,
  wasBlocked: boolean,
  wasKill: boolean
}
```

#### `game:player_died`
```typescript
{ userId, killerId }
```

#### `game:player_respawned`
```typescript
{ userId, position, health }
```

## 6. Combat Resolution Logic

This runs on the server when `game:attack` is received. Put this in a separate file:

### `services/api/src/handlers/gameWorld/combat.ts`

```typescript
function resolveAttack(attacker: PlayerState, attackType: 'light' | 'heavy'): DamageResult[] {
  const results: DamageResult[] = [];

  const ATTACK_RANGE = 2.5;  // meters
  const LIGHT_DAMAGE = 15;
  const HEAVY_DAMAGE = 30;
  const BLOCK_REDUCTION = 0.8;  // blocks reduce 80% damage
  const DODGE_WINDOW_MS = 500;  // i-frame duration
  const DAMAGE_COOLDOWN_MS = 300;  // can't be hit twice in 300ms

  const baseDamage = attackType === 'light' ? LIGHT_DAMAGE : HEAVY_DAMAGE;

  // Scale with attacker's strength
  const strengthBonus = (attacker.strength - 10) / 100;  // +1% per point above 10
  const damage = Math.round(baseDamage * (1 + strengthBonus));

  const now = Date.now();

  for (const [id, victim] of players) {
    if (id === attacker visitorId) continue;  // can't hit yourself
    if (victim.isDead) continue;

    // Distance check
    const dx = attacker.position.x - victim.position.x;
    const dy = attacker.position.y - victim.position.y;
    const dz = attacker.position.z - victim.position.z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (distance > ATTACK_RANGE) continue;

    // Facing check — attacker must be roughly facing victim
    // Attacker's forward direction from rotation.y (yaw in degrees)
    const attackerYaw = attacker.rotation.y * Math.PI / 180;
    const attackerForward = { x: Math.sin(attackerYaw), z: Math.cos(attackerYaw) };

    // Direction from attacker to victim
    const toVictim = { x: victim.position.x - attacker.position.x, z: victim.position.z - attacker.position.z };
    const toVictimLen = Math.sqrt(toVictim.x * toVictim.x + toVictim.z * toVictim.z);
    if (toVictimLen < 0.01) continue;
    toVictim.x /= toVictimLen;
    toVictim.z /= toVictimLen;

    // Dot product — must be > 0.5 (within ~60 degrees)
    const dot = attackerForward.x * toVictim.x + attackerForward.z * toVictim.z;
    if (dot < 0.5) continue;

    // Damage cooldown
    if (now - victim.lastDamageTime < DAMAGE_COOLDOWN_MS) continue;

    // Dodge check — if victim is in dodge i-frames, miss
    if (victim.action === 'dodge' && (now - victim.actionTimestamp) < DODGE_WINDOW_MS) {
      continue;  // dodged!
    }

    // Block check — if victim is blocking AND facing the attacker
    let wasBlocked = false;
    let finalDamage = damage;

    if (victim.action === 'block') {
      const victimYaw = victim.rotation.y * Math.PI / 180;
      const victimForward = { x: Math.sin(victimYaw), z: Math.cos(victimYaw) };

      // Victim must be facing attacker (dot product of victim forward and direction to attacker)
      const toAttacker = { x: -toVictim.x, z: -toVictim.z };
      const blockDot = victimForward.x * toAttacker.x + victimForward.z * toAttacker.z;

      if (blockDot > 0.3) {  // facing roughly toward attacker
        wasBlocked = true;
        finalDamage = Math.round(damage * (1 - BLOCK_REDUCTION));
        // Defense stat reduces remaining damage further
        const defenseReduction = victim.defense / 200;  // max 50% at defense 100
        finalDamage = Math.round(finalDamage * (1 - defenseReduction));
      }
    }

    // Apply damage
    victim.health = Math.max(0, victim.health - finalDamage);
    victim.lastDamageTime = now;
    victim.action = 'hit';
    victim.actionTimestamp = now;

    const wasKill = victim.health <= 0;
    if (wasKill) {
      victim.isDead = true;
      victim.action = 'dead';
    }

    results.push({
      attackerId: attacker.userId,
      victimId: victim.userId,
      damage: finalDamage,
      victimHealthAfter: victim.health,
      wasBlocked,
      wasKill
    });
  }

  return results;
}
```

**IMPORTANT NOTES:**
- Fix the typo above: `attacker visitorId` should be `attacker.userId`
- All combat math happens server-side. Clients NEVER determine if they hit someone.
- Stamina regenerates at 5/sec. Add a setInterval on the server that ticks every 200ms and regens stamina for all alive players.
- Dead players respawn after 5 seconds at their spawn point with full health.

## 7. Respawn System

Add a setTimeout when a player dies:
```typescript
setTimeout(() => {
  if (player.isDead) {
    player.isDead = false;
    player.health = player.maxHealth;
    player.stamina = player.maxStamina;
    player.action = 'idle';
    player.position = { x: player.spawnX, y: player.spawnY, z: player.spawnZ };

    io.emit('game:player_respawned', {
      userId: player.userId,
      position: player.position,
      health: player.health
    });

    // Record death in DB (async, fire and forget)
    Data.playerCharacter.recordDeath(player.characterId);
  }
}, 5000);
```

When attacker gets a kill:
```typescript
Data.playerCharacter.recordKill(attacker.characterId);
Data.playerCharacter.addXP(attacker.characterId, 50);
```

## 8. Stamina Tick

Run every 200ms:
```typescript
setInterval(() => {
  const now = Date.now();
  for (const [id, player] of players) {
    if (player.isDead) continue;
    if (player.stamina < player.maxStamina && player.action !== 'block') {
      player.stamina = Math.min(player.maxStamina, player.stamina + 1);
    }
  }
}, 200);
```

## 9. Rate Limiting Movement Broadcasts

Don't broadcast every `game:move` — rate limit to 10 per second per player:
```typescript
const lastBroadcast: Map<string, number> = new Map();
const BROADCAST_INTERVAL = 100; // ms

function shouldBroadcast(userId: string): boolean {
  const now = Date.now();
  const last = lastBroadcast.get(userId) || 0;
  if (now - last >= BROADCAST_INTERVAL) {
    lastBroadcast.set(userId, now);
    return true;
  }
  return false;
}
```

## 10. Registration in Server

The game world Socket.IO handler needs to be registered in the server startup. Look at how the chat handler is registered in `services/api/src/index.ts` or wherever Socket.IO is initialized. Register the game world handler on the same Socket.IO server but potentially under a `/game` namespace:

```typescript
const gameNs = io.of('/game');
registerGameWorldHandler(gameNs);
```

This keeps game traffic separate from chat traffic.

## 11. File Summary

Create these files:
```
prisma/schema.prisma                              — add player_character model
core/data/playerCharacter/index.ts                — CRUD data module
core/data/index.ts                                — register playerCharacter
core/actions/character/createCharacterAction.ts    — create character action
core/actions/character/getCharacterAction.ts       — get character action
services/api/src/routes/v1/character.ts            — HTTP routes
services/api/src/routes/v1/index.ts                — register character routes
services/api/src/handlers/gameWorld/index.ts       — Socket.IO game world handler
services/api/src/handlers/gameWorld/combat.ts      — combat resolution logic
```

## 12. Architecture Standards

Follow CommsLink2's strict three-layer pattern:
- **Data modules**: Prisma queries only, typed DTOs, default export
- **Actions**: Business logic, tracer.trace wrapping, Boom errors
- **Routes**: Joi validation, tracer wrapping, auth: 'jwt'
- **JSDoc** on all public functions
- **Box drawing** section dividers
- **No `any` types**
- Import order: Node → Actions → Adapters → Data → Prisma types → Types

## 13. Deploy

After implementing:
```bash
bash scripts/deploy.sh api "Add real-time game world with PvP combat"
```

Then SSH into EC2 and run `prisma db push` to create the new table:
```bash
docker exec commslink2-api npx prisma db push
```
