# Recruit System v2 — CommsLink Instructions

## Design Change

Recruits are NOT inventory items. They are **AI-controlled player characters** in the `player_character` table. When a player buys a recruit, a new `player_character` row is created that is linked to the buyer as their commander.

## 1. Schema Changes

### Update `player_character` table — add these fields:

```prisma
model player_character {
  // ... existing fields ...

  // Recruit system
  is_npc        Boolean  @default(false)    // true = AI-controlled recruit, false = real player
  commander_id  String?                      // user_id of the player who owns this recruit
  npc_type      String?                      // "peasant_levy", "militia_swordsman", "man_at_arms", etc.
  npc_class     String?                      // "melee", "ranged", "tank", "elite"
  is_alive      Boolean  @default(true)      // false = dead in battle, can be revived or dismissed

  commander     user?    @relation("CommanderRecruits", fields: [commander_id], references: [id])

  // ... existing relations ...
}
```

Add to `user` model:
```prisma
  recruits  player_character[] @relation("CommanderRecruits")
```

## 2. New Item Definitions for Recruits

Keep the recruit items in `item_definition` (they represent the "purchase token" at the shop). Same items as before:
- Peasant Levy (50g)
- Militia Swordsman (150g)
- Man-at-Arms (500g)
- Veteran Knight (2000g)
- Elite Champion (5000g)
- Crossbowman (400g)
- Shield Bearer (600g)

BUT: these items are `item_type: "recruit"`. When purchased, they are NOT added to inventory. Instead, a new `player_character` is created.

## 3. Update Buy Logic

### `core/actions/shop/buyItemAction.ts`

After the gold deduction, check if the item is a recruit:

```typescript
if (itemDef.item_type === 'recruit') {
  // Don't add to inventory — create an AI character instead
  const recruitName = generateRecruitName(); // Random medieval name

  await Data.playerCharacter.create({
    user_id: character.user_id,  // Same user account
    name: recruitName,
    is_npc: true,
    commander_id: character.user_id,
    npc_type: itemDef.name.toLowerCase().replace(/ /g, '_'), // "peasant_levy"
    npc_class: getRecruitClass(itemDef.name), // "melee", "ranged", "tank", "elite"
    is_alive: true,
    // Stats from item definition bonuses
    strength: itemDef.strength_bonus,
    defense: itemDef.defense_bonus,
    speed: itemDef.speed_bonus,
    max_health: itemDef.health_bonus,
    max_stamina: 100,
    level: 1,
    xp: 0,
    // Spawn near commander (will be overridden by Unity client)
    spawn_x: 0,
    spawn_y: 0,
    spawn_z: 0,
  });

  // Log transaction as before
  // Return the recruit info
  return {
    success: true,
    type: 'recruit',
    recruit_name: recruitName,
    npc_type: itemDef.name,
    total_price: totalPrice,
    gold_remaining: goldItem.quantity - totalPrice,
  };
} else {
  // Normal item purchase — add to inventory as before
}
```

### Name Generator

```typescript
function generateRecruitName(): string {
  const firstNames = [
    'Aldric', 'Baldric', 'Cedric', 'Derrick', 'Edmund', 'Fulton', 'Gareth',
    'Harold', 'Irwin', 'Jasper', 'Kendrick', 'Leofric', 'Magnus', 'Norbert',
    'Oswald', 'Percival', 'Quinton', 'Roland', 'Sigmund', 'Theron',
    'Ulric', 'Vaughn', 'Wulfric', 'Yorick', 'Aldwin', 'Brant', 'Conrad',
    'Dunstan', 'Egbert', 'Finn', 'Godric', 'Hector', 'Ivan', 'Jarvis',
  ];
  const lastNames = [
    'the Bold', 'the Brave', 'Ironside', 'Strongarm', 'Blackwood',
    'Stonewall', 'Redhelm', 'of Ashford', 'the Grim', 'Shieldbreaker',
    'Warborn', 'the Steady', 'Oakheart', 'of Millhaven', 'the Quick',
    'Hammerfall', 'Greycloak', 'the Silent', 'Thornwall', 'Battleborn',
  ];
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

function getRecruitClass(name: string): string {
  if (name.includes('Crossbow')) return 'ranged';
  if (name.includes('Shield')) return 'tank';
  if (name.includes('Champion') || name.includes('Knight')) return 'elite';
  return 'melee';
}
```

## 4. New API Endpoints

### GET /api/v1/recruits (auth required)
Returns all recruits owned by the authenticated user:

```json
{
  "recruits": [
    {
      "id": "uuid",
      "name": "Aldric the Bold",
      "npc_type": "man_at_arms",
      "npc_class": "melee",
      "level": 1,
      "strength": 10,
      "defense": 10,
      "speed": 5,
      "max_health": 80,
      "is_alive": true
    }
  ]
}
```

### DELETE /api/v1/recruits/:id (auth required)
Dismiss a recruit (delete from DB). Only the commander can dismiss.

### New data module methods:
- `Data.playerCharacter.findRecruitsByCommander(userId)` — get all NPCs for a user
- `Data.playerCharacter.createRecruit(data)` — create with is_npc=true

Note: The `player_character` table now needs `@@unique` removed from `user_id` since a user can have multiple characters (their main + recruits). Change `@unique` to just `@index` on user_id, OR keep the constraint and use `commander_id` instead of `user_id` for recruits.

**Actually**: recruits should NOT have a `user_id` pointing to the commander. Use a separate `commander_id` field. The `user_id` should be null or a generated UUID for NPCs. This keeps the unique constraint on user_id for real players.

Revised approach:
- Real players: `user_id = their auth user ID`, `is_npc = false`, `commander_id = null`
- Recruits: `user_id = generated UUID` (fake, just for uniqueness), `is_npc = true`, `commander_id = real player's user_id`

Or simpler: remove the `@unique` from `user_id` on player_character since multiple recruits can share a commander.

## 5. Update Shop Buy Response

The buy endpoint should return different data for recruits vs items:

```json
// Recruit purchase
{
  "success": true,
  "type": "recruit",
  "recruit": {
    "id": "uuid",
    "name": "Aldric the Bold",
    "npc_type": "man_at_arms",
    "npc_class": "melee",
    "strength": 10,
    "defense": 10,
    "max_health": 80
  },
  "total_price": 500,
  "gold_remaining": 99499
}

// Normal item purchase
{
  "success": true,
  "type": "item",
  "item_name": "Iron Broadsword",
  "quantity": 1,
  "total_price": 100,
  "gold_remaining": 99899
}
```

## 6. Deploy

```bash
bash scripts/deploy.sh api "Add recruit system - AI companions as player_characters"
docker exec commslink2-api npx prisma db push
curl -X POST https://commslink.net/api/v1/items/seed -H "Authorization: Bearer ADMIN_TOKEN"
curl -X POST https://commslink.net/api/v1/shops/seed -H "Authorization: Bearer ADMIN_TOKEN"
```
