# Leveling System — CommsLink Implementation Instructions

## Context

The game needs a leveling system where XP thresholds per level are stored in a database table so they can be adjusted without code changes. The Unity client will display an XP bar and the server handles all XP/level logic.

## 1. New Prisma Table: `level_definition`

Add to `prisma/schema.prisma`:

```prisma
model level_definition {
  level       Int @id
  xp_required Int // Total cumulative XP needed to reach this level

  // Future: stat bonuses per level
  strength_bonus  Int @default(0)
  defense_bonus   Int @default(0)
  speed_bonus     Int @default(0)
  health_bonus    Int @default(0)
  stamina_bonus   Int @default(0)

  created_at DateTime @default(now())
}
```

## 2. Seed Level Data

Create a seed endpoint or script. Start with 50 levels. XP curve should feel like a classic MMO — early levels fast, later levels slow:

```typescript
const LEVELS = [];
for (let i = 1; i <= 50; i++) {
  // Exponential curve: level 1 = 0 XP, level 2 = 100, level 3 = 250, etc.
  // Formula: xp_required = floor(50 * (level - 1) ^ 1.8)
  const xp = i === 1 ? 0 : Math.floor(50 * Math.pow(i - 1, 1.8));
  LEVELS.push({ level: i, xp_required: xp });
}
```

This gives roughly:
- Level 1: 0 XP
- Level 2: 50 XP
- Level 5: 550 XP
- Level 10: 2,500 XP
- Level 15: 6,500 XP
- Level 20: 13,000 XP
- Level 30: 34,000 XP
- Level 40: 68,000 XP
- Level 50: 115,000 XP

## 3. New Data Module: `core/data/levelDefinition/index.ts`

```typescript
- findAll() — get all level definitions ordered by level
- findByLevel(level: number) — get single level definition
- getMaxLevel() — returns the highest level number
```

Register in `core/data/index.ts` as `levelDefinition`.

## 4. New Action: `core/actions/character/addXPAction.ts`

This is the core leveling logic. Called whenever a player gains XP (kill, quest, etc.):

```typescript
async function addXPAction(characterId: string, xpAmount: number) {
  const character = await Data.playerCharacter.findById(characterId);
  if (!character) throw Boom.notFound('Character not found');

  const newXP = character.xp + xpAmount;

  // Get all level definitions
  const levels = await Data.levelDefinition.findAll();

  // Find the new level based on total XP
  let newLevel = 1;
  for (const lvl of levels) {
    if (newXP >= lvl.xp_required) {
      newLevel = lvl.level;
    } else {
      break;
    }
  }

  const leveledUp = newLevel > character.level;

  // Update character
  await Data.playerCharacter.update(character.id, {
    xp: newXP,
    level: newLevel,
  });

  // If leveled up, apply stat bonuses from the level definition
  // (future — for now just update level)

  return {
    xp: newXP,
    level: newLevel,
    leveled_up: leveledUp,
    previous_level: character.level,
  };
}
```

## 5. New/Updated API Endpoints

### GET /api/v1/levels
Returns all level definitions. Public endpoint (no auth needed).
```json
{
  "levels": [
    { "level": 1, "xp_required": 0 },
    { "level": 2, "xp_required": 50 },
    ...
  ]
}
```

### POST /api/v1/levels/seed (admin only)
Seeds all 50 levels into the database. Upserts so it can be re-run safely.

### GET /api/v1/characters/me
Already exists — make sure it returns `xp` and `level` fields (it does).

### POST /api/v1/characters/add-xp (auth required)
For testing. Adds XP to the authenticated user's character.
```json
Request: { "amount": 100 }
Response: { "xp": 150, "level": 2, "leveled_up": true, "previous_level": 1 }
```

## 6. Update the game world handler

When a player gets a kill (in `services/api/src/handlers/gameWorld/combat.ts` or `index.ts`), call `addXPAction` instead of just `Data.playerCharacter.addXP`. This ensures leveling logic runs server-side.

## 7. Deploy

```bash
bash scripts/deploy.sh api "Add leveling system with DB-driven XP thresholds"
docker exec commslink2-api npx prisma db push
```

Then seed levels:
```bash
curl -X POST https://commslink.net/api/v1/levels/seed -H "Authorization: Bearer ADMIN_TOKEN"
```
