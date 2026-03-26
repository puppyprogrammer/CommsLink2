import Data from '../../data';

/** Give a new character their starter items. */
const giveStarterItems = async (characterId: string): Promise<void> => {
  const broadsword = await Data.itemDefinition.findByName('Iron Broadsword');
  const shield = await Data.itemDefinition.findByName('Wooden Shield');
  const healthPot = await Data.itemDefinition.findByName('Health Potion');
  const gold = await Data.itemDefinition.findByName('Gold Coin');

  if (broadsword) await Data.inventoryItem.addItem(characterId, broadsword.id, 1, 0);
  if (shield) await Data.inventoryItem.addItem(characterId, shield.id, 1, 1);
  if (healthPot) await Data.inventoryItem.addItem(characterId, healthPot.id, 3, 2);
  if (gold) await Data.inventoryItem.addItem(characterId, gold.id, 100, 3);
};

export default giveStarterItems;
