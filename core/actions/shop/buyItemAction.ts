import Boom from '@hapi/boom';
import tracer from '../../lib/tracer';
import Data from '../../data';

type BuyResult = {
  success: boolean;
  type: 'item' | 'recruit';
  item_name?: string;
  quantity?: number;
  total_price: number;
  gold_remaining: number;
  recruit?: {
    id: string;
    name: string;
    npc_type: string;
    npc_class: string;
    strength: number;
    defense: number;
    speed: number;
    max_health: number;
  };
};

// ── Name Generator ──

const FIRST_NAMES = [
  'Aldric', 'Baldric', 'Cedric', 'Derrick', 'Edmund', 'Fulton', 'Gareth',
  'Harold', 'Irwin', 'Jasper', 'Kendrick', 'Leofric', 'Magnus', 'Norbert',
  'Oswald', 'Percival', 'Quinton', 'Roland', 'Sigmund', 'Theron',
  'Ulric', 'Vaughn', 'Wulfric', 'Yorick', 'Aldwin', 'Brant', 'Conrad',
  'Dunstan', 'Egbert', 'Finn', 'Godric', 'Hector', 'Ivan', 'Jarvis',
];

const LAST_NAMES = [
  'the Bold', 'the Brave', 'Ironside', 'Strongarm', 'Blackwood',
  'Stonewall', 'Redhelm', 'of Ashford', 'the Grim', 'Shieldbreaker',
  'Warborn', 'the Steady', 'Oakheart', 'of Millhaven', 'the Quick',
  'Hammerfall', 'Greycloak', 'the Silent', 'Thornwall', 'Battleborn',
];

const generateRecruitName = (): string =>
  `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;

const getRecruitClass = (name: string): string => {
  if (name.includes('Crossbow')) return 'ranged';
  if (name.includes('Shield')) return 'tank';
  if (name.includes('Champion') || name.includes('Knight')) return 'elite';
  return 'melee';
};

/** Buy an item or recruit from a shop. */
const buyItemAction = async (
  shopName: string,
  itemDefId: string,
  quantity: number,
  userId: string,
): Promise<BuyResult> =>
  tracer.trace('ACTION.SHOP.BUY', async () => {
    const shop = await Data.shop.findByName(shopName);
    if (!shop) throw Boom.notFound('Shop not found');

    const stock = await Data.shopStock.findByShopAndItem(shop.id, itemDefId);
    if (!stock) throw Boom.notFound('Item not in stock');

    if (stock.quantity !== -1 && stock.quantity < quantity) {
      throw Boom.conflict('Not enough stock');
    }

    const itemDef = await Data.itemDefinition.findById(itemDefId);
    if (!itemDef) throw Boom.notFound('Item definition not found');
    const unitPrice = stock.price_override ?? Math.round(itemDef.buy_price * shop.buy_markup);
    const totalPrice = unitPrice * quantity;

    const character = await Data.playerCharacter.findByUserId(userId);
    if (!character) throw Boom.notFound('Character not found');

    // Check gold
    const goldDef = await Data.itemDefinition.findByName('Gold Coin');
    if (!goldDef) throw Boom.internal('Gold Coin item not defined');
    const goldItem = await Data.inventoryItem.findByCharacterAndItem(character.id, goldDef.id);
    if (!goldItem || goldItem.quantity < totalPrice) {
      throw Boom.conflict('Not enough gold');
    }

    // Deduct gold
    await Data.inventoryItem.updateQuantity(goldItem.id, goldItem.quantity - totalPrice);

    // Deduct stock if not unlimited
    if (stock.quantity !== -1) {
      await Data.shopStock.update(stock.id, { quantity: stock.quantity - quantity });
    }

    // Log transaction
    await Data.shopTransaction.create({
      shop_id: shop.id,
      character_id: character.id,
      item_def_id: itemDefId,
      quantity,
      total_price: totalPrice,
      type: 'buy',
    });

    // ── Recruit purchase ──
    if (itemDef.item_type === 'recruit') {
      const recruitName = generateRecruitName();
      const npcType = itemDef.name.toLowerCase().replace(/ /g, '_');
      const npcClass = getRecruitClass(itemDef.name);

      // Generate random personality based on NPC type
      const rand = (base: number, v: number = 25) => Math.max(0, Math.min(100, base + Math.floor((Math.random() - 0.5) * v * 2)));
      const presets: Record<string, Record<string, number>> = {
        peasant_levy: { h: 60, o: 70, b: 30, c: 50, g: 40, a: 30, v: 60 },
        militia_swordsman: { h: 50, o: 60, b: 50, c: 40, g: 45, a: 50, v: 50 },
        man_at_arms: { h: 40, o: 70, b: 65, c: 30, g: 35, a: 55, v: 40 },
        veteran_knight: { h: 30, o: 55, b: 80, c: 25, g: 30, a: 60, v: 30 },
        elite_champion: { h: 25, o: 40, b: 90, c: 20, g: 25, a: 70, v: 25 },
        crossbowman: { h: 55, o: 60, b: 40, c: 50, g: 50, a: 40, v: 55 },
        shield_bearer: { h: 35, o: 80, b: 70, c: 30, g: 25, a: 25, v: 35 },
      };
      const p = presets[npcType] || presets.militia_swordsman;

      const recruit = await Data.playerCharacter.create({
        user_id: userId,
        name: recruitName,
        is_npc: true,
        commander_id: userId,
        npc_type: npcType,
        npc_class: npcClass,
        strength: itemDef.strength_bonus || 10,
        defense: itemDef.defense_bonus || 10,
        speed: itemDef.speed_bonus || 10,
        max_health: itemDef.health_bonus || 80,
        max_stamina: 100,
        trait_humor: rand(p.h),
        trait_obedience: rand(p.o),
        trait_bravery: rand(p.b),
        trait_curiosity: rand(p.c),
        trait_greed: rand(p.g),
        trait_aggression: rand(p.a),
        trait_verbosity: rand(p.v),
        mood: rand(55, 15),
        loyalty: rand(40, 15),
        familiarity: rand(10, 5),
        procreation_drive: rand(30, 20),
      });

      // Auto-assign to army structure (rank determined by auto-promotion system)
      await Data.playerCharacter.autoAssignRecruit(userId, recruit.id).catch(console.error);

      return {
        success: true,
        type: 'recruit',
        total_price: totalPrice,
        gold_remaining: goldItem.quantity - totalPrice,
        recruit: {
          id: recruit.id,
          name: recruit.name,
          npc_type: npcType,
          npc_class: npcClass,
          strength: recruit.strength,
          defense: recruit.defense,
          speed: recruit.speed,
          max_health: recruit.max_health,
        },
      };
    }

    // ── Normal item purchase ──
    if (itemDef.stackable) {
      const existing = await Data.inventoryItem.findByCharacterAndItem(character.id, itemDefId);
      if (existing) {
        await Data.inventoryItem.updateQuantity(existing.id, existing.quantity + quantity);
      } else {
        await Data.inventoryItem.addItem(character.id, itemDefId, quantity);
      }
    } else {
      for (let i = 0; i < quantity; i++) {
        await Data.inventoryItem.addItem(character.id, itemDefId, 1);
      }
    }

    return {
      success: true,
      type: 'item',
      item_name: itemDef.name,
      quantity,
      total_price: totalPrice,
      gold_remaining: goldItem.quantity - totalPrice,
    };
  });

export default buyItemAction;
