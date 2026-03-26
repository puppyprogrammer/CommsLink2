# Shop System — CommsLink Implementation Instructions

## Context

The game needs a shop system where NPC shopkeepers sell items to players. Each shop is a database entity with its own inventory. Players buy items by spending gold. All transactions are logged.

## 1. New Prisma Tables

### `shop`
```prisma
model shop {
  id          String   @id @default(uuid())
  name        String   @unique  // "mercenary_recruiter", "village_blacksmith", etc.
  display_name String             // "Ser Galahad's Mercenary Camp"
  shop_type   String              // recruiter, blacksmith, potion_seller, general_store
  description String?  @db.Text   // Flavor text shown in shop UI
  buy_markup  Float    @default(1.0)  // Multiplier on item buy_price (1.0 = normal, 1.5 = 50% markup)
  sell_discount Float  @default(0.5)  // Multiplier on item sell_price when player sells TO shop
  is_active   Boolean  @default(true)
  created_at  DateTime @default(now())

  stock shop_stock[]
  transactions shop_transaction[]

  @@index([shop_type])
  @@index([is_active])
}
```

### `shop_stock`
```prisma
model shop_stock {
  id          String @id @default(uuid())
  shop_id     String
  item_def_id String
  quantity    Int    @default(-1)  // -1 = unlimited stock
  price_override Int?              // null = use item_definition.buy_price * shop.buy_markup

  shop     shop            @relation(fields: [shop_id], references: [id], onDelete: Cascade)
  item_def item_definition @relation(fields: [item_def_id], references: [id])

  @@unique([shop_id, item_def_id])
  @@index([shop_id])
}
```

### `shop_transaction`
```prisma
model shop_transaction {
  id           String   @id @default(uuid())
  shop_id      String
  character_id String
  item_def_id  String
  quantity     Int
  total_price  Int      // Gold spent
  type         String   // "buy" or "sell"
  created_at   DateTime @default(now())

  shop      shop              @relation(fields: [shop_id], references: [id])
  character player_character  @relation(fields: [character_id], references: [id])
  item_def  item_definition   @relation(fields: [item_def_id], references: [id])

  @@index([shop_id, created_at])
  @@index([character_id, created_at])
}
```

Add `shop_transactions shop_transaction[]` to `player_character` model.
Add `shop_stock shop_stock[]` to `item_definition` model.

## 2. Seed Data — Mercenary Recruiter Shop

Create the first shop with soldier-type items for sale:

```typescript
// Shop
const shop = await Data.shop.create({
  name: 'mercenary_recruiter',
  display_name: "Commander Roderick's War Camp",
  shop_type: 'recruiter',
  description: 'Battle-hardened veterans and fine weapons, available for the right price.',
  buy_markup: 1.0,
});

// Stock it with all weapons and shields
const weapons = await Data.itemDefinition.findByType('weapon');
const shields = await Data.itemDefinition.findByType('shield');
const potions = await Data.itemDefinition.findByType('consumable');

for (const item of [...weapons, ...shields, ...potions]) {
  await Data.shopStock.create({
    shop_id: shop.id,
    item_def_id: item.id,
    quantity: -1, // unlimited
  });
}
```

## 3. New Data Modules

### `core/data/shop/index.ts`
- `create(data)` — create shop
- `findById(id)` — get shop
- `findByName(name)` — get shop by unique name
- `findAll()` — list all shops

### `core/data/shopStock/index.ts`
- `create(data)` — add item to shop
- `findByShop(shopId)` — get all stock with item_def joined
- `update(id, data)` — update quantity
- `remove(id)` — remove stock item

### `core/data/shopTransaction/index.ts`
- `create(data)` — log a transaction
- `findByShop(shopId, limit)` — shop transaction history
- `findByCharacter(characterId, limit)` — player purchase history

Register all in `core/data/index.ts`.

## 4. New Action: `core/actions/shop/buyItemAction.ts`

This is the core purchase logic:

```typescript
async function buyItemAction(
  shopName: string,
  itemDefId: string,
  quantity: number,
  userId: string
) {
  // 1. Find shop
  const shop = await Data.shop.findByName(shopName);
  if (!shop) throw Boom.notFound('Shop not found');

  // 2. Find stock entry
  const stock = await Data.shopStock.findByShopAndItem(shop.id, itemDefId);
  if (!stock) throw Boom.notFound('Item not in stock');

  // 3. Check stock quantity
  if (stock.quantity !== -1 && stock.quantity < quantity) {
    throw Boom.conflict('Not enough stock');
  }

  // 4. Calculate price
  const itemDef = await Data.itemDefinition.findById(itemDefId);
  const unitPrice = stock.price_override ?? Math.round(itemDef.buy_price * shop.buy_markup);
  const totalPrice = unitPrice * quantity;

  // 5. Find player character and check gold
  const character = await Data.playerCharacter.findByUserId(userId);
  if (!character) throw Boom.notFound('Character not found');

  // Find gold in inventory
  const goldDef = await Data.itemDefinition.findByName('Gold Coin');
  const goldItem = await Data.inventoryItem.findByCharacterAndItem(character.id, goldDef.id);

  if (!goldItem || goldItem.quantity < totalPrice) {
    throw Boom.conflict('Not enough gold');
  }

  // 6. Deduct gold
  await Data.inventoryItem.updateQuantity(goldItem.id, goldItem.quantity - totalPrice);

  // 7. Add item to player inventory
  // Check if player already has this item (stackable)
  const existing = await Data.inventoryItem.findByCharacterAndItem(character.id, itemDefId);
  if (existing && itemDef.stackable) {
    await Data.inventoryItem.updateQuantity(existing.id, existing.quantity + quantity);
  } else {
    // Find first empty slot
    const inventory = await Data.inventoryItem.findByCharacter(character.id);
    const usedSlots = new Set(inventory.map(i => i.slot_index).filter(s => s !== null));
    let freeSlot = 0;
    while (usedSlots.has(freeSlot) && freeSlot < 28) freeSlot++;

    await Data.inventoryItem.addItem(character.id, itemDefId, quantity, freeSlot);
  }

  // 8. Deduct stock if not unlimited
  if (stock.quantity !== -1) {
    await Data.shopStock.update(stock.id, { quantity: stock.quantity - quantity });
  }

  // 9. Log transaction
  await Data.shopTransaction.create({
    shop_id: shop.id,
    character_id: character.id,
    item_def_id: itemDefId,
    quantity,
    total_price: totalPrice,
    type: 'buy',
  });

  return {
    success: true,
    item_name: itemDef.name,
    quantity,
    total_price: totalPrice,
    gold_remaining: goldItem.quantity - totalPrice,
  };
}
```

## 5. New API Endpoints

### `services/api/src/routes/v1/shop.ts`

```
GET  /api/v1/shops/:name          — get shop details + stock (auth required)
POST /api/v1/shops/:name/buy      — buy item from shop (auth required)
  body: { item_def_id: string, quantity: number }
  returns: { success, item_name, quantity, total_price, gold_remaining }
POST /api/v1/shops/seed            — seed shops (admin only)
GET  /api/v1/shops                 — list all shops (auth required)
```

Register in `services/api/src/routes/v1/index.ts`.

### Response Format for GET /api/v1/shops/:name
```json
{
  "id": "uuid",
  "name": "mercenary_recruiter",
  "display_name": "Commander Roderick's War Camp",
  "shop_type": "recruiter",
  "description": "Battle-hardened veterans...",
  "stock": [
    {
      "item_def_id": "uuid",
      "quantity": -1,
      "price": 100,
      "item_def": {
        "id": "uuid",
        "name": "Iron Broadsword",
        "icon_name": "SM_Wep_Broadsword_01",
        "item_type": "weapon",
        "slot": "main_hand",
        "rarity": "common",
        "strength_bonus": 5,
        "buy_price": 100
      }
    }
  ]
}
```

The `price` field should be calculated: `stock.price_override ?? Math.round(item_def.buy_price * shop.buy_markup)`.

## 6. Data Module Additions

### `core/data/inventoryItem/index.ts` — add these methods:
- `findByCharacterAndItem(characterId, itemDefId)` — find specific item in player's inventory
- `updateQuantity(id, newQuantity)` — update stack count (delete if 0)

### `core/data/itemDefinition/index.ts` — add:
- `findByName(name)` — find item definition by name
- `findByType(type)` — find all items of a type

## 7. Deploy

```bash
bash scripts/deploy.sh api "Add shop system with transactions and stock"
docker exec commslink2-api npx prisma db push
```

Then seed:
```bash
curl -X POST https://commslink.net/api/v1/shops/seed -H "Authorization: Bearer ADMIN_TOKEN"
```
