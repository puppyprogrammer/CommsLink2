# Recruit System — CommsLink Instructions

## Context

The mercenary recruiter NPC sells **soldiers/recruits**, not weapons. These are companions the player can command in battle (like Mount & Blade Warband). Recruits are items in the inventory system — when "used", they spawn an AI companion.

## 1. New Item Definitions — Recruits

Seed these new item definitions. They use `item_type: "recruit"` and `slot: null` (non-equippable, stored in inventory).

```typescript
const RECRUITS = [
  {
    name: 'Peasant Levy',
    description: 'A barely trained villager with a pitchfork. Cheap but expendable.',
    icon_name: 'recruit_peasant',
    item_type: 'recruit',
    slot: null,
    rarity: 'common',
    stackable: true,
    max_stack: 20,
    strength_bonus: 2,    // Used as the recruit's combat stats
    defense_bonus: 1,
    speed_bonus: 3,
    health_bonus: 30,     // Recruit's HP
    stamina_bonus: 0,
    buy_price: 50,
    sell_price: 10,
  },
  {
    name: 'Militia Swordsman',
    description: 'A town guard with basic training and a short sword.',
    icon_name: 'recruit_militia',
    item_type: 'recruit',
    slot: null,
    rarity: 'common',
    stackable: true,
    max_stack: 15,
    strength_bonus: 5,
    defense_bonus: 4,
    speed_bonus: 4,
    health_bonus: 50,
    stamina_bonus: 0,
    buy_price: 150,
    sell_price: 30,
  },
  {
    name: 'Man-at-Arms',
    description: 'A professional soldier equipped with sword, shield, and chainmail.',
    icon_name: 'recruit_manatarms',
    item_type: 'recruit',
    slot: null,
    rarity: 'uncommon',
    stackable: true,
    max_stack: 10,
    strength_bonus: 10,
    defense_bonus: 10,
    speed_bonus: 5,
    health_bonus: 80,
    stamina_bonus: 0,
    buy_price: 500,
    sell_price: 100,
  },
  {
    name: 'Veteran Knight',
    description: 'A battle-hardened knight in full plate armor. A formidable warrior.',
    icon_name: 'recruit_knight',
    item_type: 'recruit',
    slot: null,
    rarity: 'rare',
    stackable: true,
    max_stack: 5,
    strength_bonus: 18,
    defense_bonus: 16,
    speed_bonus: 8,
    health_bonus: 120,
    stamina_bonus: 0,
    buy_price: 2000,
    sell_price: 400,
  },
  {
    name: 'Elite Champion',
    description: 'A legendary warrior of unmatched skill. Commands respect on any battlefield.',
    icon_name: 'recruit_champion',
    item_type: 'recruit',
    slot: null,
    rarity: 'epic',
    stackable: true,
    max_stack: 3,
    strength_bonus: 25,
    defense_bonus: 22,
    speed_bonus: 12,
    health_bonus: 180,
    stamina_bonus: 0,
    buy_price: 5000,
    sell_price: 1000,
  },
  {
    name: 'Crossbowman',
    description: 'A ranged soldier with a crossbow. Deadly at distance, vulnerable in melee.',
    icon_name: 'recruit_crossbow',
    item_type: 'recruit',
    slot: null,
    rarity: 'uncommon',
    stackable: true,
    max_stack: 10,
    strength_bonus: 12,
    defense_bonus: 3,
    speed_bonus: 5,
    health_bonus: 45,
    stamina_bonus: 0,
    buy_price: 400,
    sell_price: 80,
  },
  {
    name: 'Shield Bearer',
    description: 'A heavily armored defender. Slow but nearly impervious to frontal attacks.',
    icon_name: 'recruit_shieldbearer',
    item_type: 'recruit',
    slot: null,
    rarity: 'uncommon',
    stackable: true,
    max_stack: 10,
    strength_bonus: 6,
    defense_bonus: 20,
    speed_bonus: 2,
    health_bonus: 100,
    stamina_bonus: 0,
    buy_price: 600,
    sell_price: 120,
  },
];
```

## 2. Update Mercenary Recruiter Shop

Change the mercenary_recruiter shop stock to ONLY contain recruits (remove weapons/shields/potions):

```typescript
// Clear existing stock for mercenary_recruiter
await Data.shopStock.deleteByShop(mercenaryRecruiterShopId);

// Add recruit items
for (const recruit of RECRUITS) {
  const itemDef = await Data.itemDefinition.findByName(recruit.name);
  if (itemDef) {
    await Data.shopStock.create({
      shop_id: mercenaryRecruiterShopId,
      item_def_id: itemDef.id,
      quantity: -1, // unlimited
    });
  }
}
```

## 3. New Data Module Methods

### `core/data/shopStock/index.ts` — add:
- `deleteByShop(shopId)` — clear all stock for a shop

### `core/data/itemDefinition/index.ts` — update seed to include recruits

## 4. Deploy

```bash
bash scripts/deploy.sh api "Add recruit items and update mercenary recruiter shop"
docker exec commslink2-api npx prisma db push
```

Then re-seed:
```bash
curl -X POST https://commslink.net/api/v1/items/seed -H "Authorization: Bearer ADMIN_TOKEN"
curl -X POST https://commslink.net/api/v1/shops/seed -H "Authorization: Bearer ADMIN_TOKEN"
```
