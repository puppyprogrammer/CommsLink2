# Inventory & Items System — CommsLink Implementation Instructions

## Context

The Unity game needs a full inventory and equipment system. Items are stored server-side. The Unity client displays them in a RuneScape-style grid UI.

## 1. New Prisma Tables

Add to `prisma/schema.prisma`:

```prisma
model item_definition {
  id          String  @id @default(uuid())
  name        String  @unique
  description String? @db.Text
  icon_name   String  // matches Unity sprite/prefab name
  item_type   String  // weapon, shield, helmet, chest, legs, boots, gloves, ring, amulet, consumable, material, quest
  slot        String? // main_hand, off_hand, head, chest, legs, feet, hands, ring, neck, null for non-equippable
  rarity      String  @default("common") // common, uncommon, rare, epic, legendary
  stackable   Boolean @default(false)
  max_stack   Int     @default(1)

  // Stats (for equipment)
  strength_bonus  Int @default(0)
  defense_bonus   Int @default(0)
  speed_bonus     Int @default(0)
  health_bonus    Int @default(0)
  stamina_bonus   Int @default(0)

  // Economy
  buy_price   Int @default(0)
  sell_price  Int @default(0)

  created_at DateTime @default(now())

  inventory_items inventory_item[]

  @@index([item_type])
  @@index([rarity])
}

model inventory_item {
  id            String @id @default(uuid())
  character_id  String
  item_def_id   String
  quantity      Int    @default(1)
  slot_index    Int?   // position in inventory grid (0-27), null = auto-place
  is_equipped   Boolean @default(false)
  equip_slot    String? // main_hand, off_hand, head, chest, legs, feet, hands, ring, neck

  character player_character @relation(fields: [character_id], references: [id], onDelete: Cascade)
  item_def  item_definition  @relation(fields: [item_def_id], references: [id])

  created_at DateTime @default(now())

  @@index([character_id])
  @@index([character_id, is_equipped])
  @@unique([character_id, slot_index]) // only one item per inventory slot
  @@unique([character_id, equip_slot]) // only one item per equip slot
}
```

Add `inventory_items inventory_item[]` to the `player_character` model's relations.

## 2. Seed Data — Default Items

Create a seed script or action that inserts these starter items:

```typescript
const STARTER_ITEMS = [
  // Weapons
  { name: 'Iron Broadsword', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Broadsword_01', rarity: 'common', strength_bonus: 5, buy_price: 100, sell_price: 25 },
  { name: 'Steel Rapier', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Rapier_01', rarity: 'uncommon', strength_bonus: 8, speed_bonus: 3, buy_price: 300, sell_price: 75 },
  { name: 'War Halberd', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Halberd_01', rarity: 'rare', strength_bonus: 15, speed_bonus: -3, buy_price: 800, sell_price: 200 },
  { name: 'Zweihander', item_type: 'weapon', slot: 'main_hand', icon_name: 'SM_Wep_Zweihander_01', rarity: 'epic', strength_bonus: 20, speed_bonus: -5, buy_price: 2000, sell_price: 500 },

  // Shields
  { name: 'Wooden Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_01', rarity: 'common', defense_bonus: 5, buy_price: 80, sell_price: 20 },
  { name: 'Iron Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_02', rarity: 'uncommon', defense_bonus: 10, buy_price: 250, sell_price: 60 },
  { name: 'Knight Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_03', rarity: 'rare', defense_bonus: 15, buy_price: 700, sell_price: 175 },
  { name: 'Royal Shield', item_type: 'shield', slot: 'off_hand', icon_name: 'SM_Wep_Shield_04', rarity: 'epic', defense_bonus: 25, buy_price: 1800, sell_price: 450 },

  // Consumables
  { name: 'Health Potion', item_type: 'consumable', slot: null, icon_name: 'potion_health', rarity: 'common', stackable: true, max_stack: 10, health_bonus: 30, buy_price: 50, sell_price: 12 },
  { name: 'Stamina Potion', item_type: 'consumable', slot: null, icon_name: 'potion_stamina', rarity: 'common', stackable: true, max_stack: 10, stamina_bonus: 50, buy_price: 40, sell_price: 10 },

  // Materials
  { name: 'Iron Ore', item_type: 'material', slot: null, icon_name: 'mat_iron', rarity: 'common', stackable: true, max_stack: 50, buy_price: 10, sell_price: 3 },
  { name: 'Gold Coin', item_type: 'material', slot: null, icon_name: 'mat_gold', rarity: 'common', stackable: true, max_stack: 99999, buy_price: 1, sell_price: 1 },
];
```

## 3. New Data Modules

### `core/data/itemDefinition/index.ts`
- `findAll()` — get all item definitions
- `findById(id)` — get single item def
- `findByType(type)` — filter by item_type
- `create(data)` — create item definition (admin only)

### `core/data/inventoryItem/index.ts`
- `findByCharacter(characterId)` — get all items for a character
- `findEquipped(characterId)` — get only equipped items
- `addItem(characterId, itemDefId, quantity, slotIndex?)` — add item to inventory
- `removeItem(id)` — remove item
- `updateQuantity(id, quantity)` — update stack count
- `equipItem(id, equipSlot)` — equip an item
- `unequipItem(id)` — unequip an item
- `moveItem(id, newSlotIndex)` — move item to different inventory slot
- `getEquippedInSlot(characterId, equipSlot)` — get item in specific equip slot

Register both in `core/data/index.ts`.

## 4. New Actions

### `core/actions/inventory/getInventoryAction.ts`
- Takes characterId
- Returns all inventory items with their item_definition data (joined)
- Include equipped items separately

### `core/actions/inventory/equipItemAction.ts`
- Takes inventoryItemId, userId (for ownership check)
- Validates: item is equippable, slot is correct, unequip existing item in that slot first
- Swaps equipment if slot occupied

### `core/actions/inventory/unequipItemAction.ts`
- Takes inventoryItemId, userId
- Unequips item, places back in first open inventory slot

### `core/actions/inventory/moveItemAction.ts`
- Takes inventoryItemId, targetSlotIndex, userId
- Swap items if target slot occupied

### `core/actions/inventory/giveStarterItems.ts`
- Called when character is created
- Gives: Iron Broadsword, Wooden Shield, 3x Health Potion, 100x Gold Coin

## 5. New Routes

### `services/api/src/routes/v1/inventory.ts`

```
GET    /api/v1/inventory              — get my inventory + equipped items (auth required)
POST   /api/v1/inventory/equip        — equip item { inventory_item_id }
POST   /api/v1/inventory/unequip      — unequip item { inventory_item_id }
POST   /api/v1/inventory/move         — move item { inventory_item_id, slot_index }
GET    /api/v1/items                  — get all item definitions (public catalog)
POST   /api/v1/items/seed             — seed starter items (admin only, one-time setup)
```

Register in `services/api/src/routes/v1/index.ts`.

## 6. Response Format

### GET /api/v1/inventory
```json
{
  "inventory": [
    {
      "id": "uuid",
      "item_def_id": "uuid",
      "quantity": 1,
      "slot_index": 0,
      "is_equipped": false,
      "equip_slot": null,
      "item_def": {
        "id": "uuid",
        "name": "Iron Broadsword",
        "icon_name": "SM_Wep_Broadsword_01",
        "item_type": "weapon",
        "slot": "main_hand",
        "rarity": "common",
        "strength_bonus": 5,
        "defense_bonus": 0,
        "speed_bonus": 0,
        "health_bonus": 0,
        "stamina_bonus": 0
      }
    }
  ],
  "equipped": [
    {
      "equip_slot": "main_hand",
      "item": { ...same as above... }
    }
  ]
}
```

## 7. Deploy

After implementing:
```bash
bash scripts/deploy.sh api "Add inventory and item system"
docker exec commslink2-api npx prisma db push
```

Then seed items:
```bash
curl -X POST https://commslink.net/api/v1/items/seed -H "Authorization: Bearer ADMIN_TOKEN"
```
