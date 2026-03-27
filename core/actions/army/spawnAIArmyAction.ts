import tracer from '../../lib/tracer';
import Data from '../../data';
import passwordHelper from '../../helpers/password';

type SpawnResult = {
  commander_user_id: string;
  commander_username: string;
  army_size: number;
  centurion_name: string;
  doctrine: string;
};

// ── Name generators ──
const COMMANDER_NAMES = [
  'Grimjaw', 'Bloodfang', 'Ironmaw', 'Darkhelm', 'Redfist', 'Skullcrusher',
  'Blackthorn', 'Deathgrip', 'Stonefist', 'Wargrave', 'Doomhammer', 'Shadowbane',
  'Ashenclaw', 'Nightblade', 'Steelgrim', 'Bonecleaver', 'Warfang', 'Hellstrike',
];

const TITLES = [
  'the Ruthless', 'the Butcher', 'the Savage', 'the Cruel', 'the Merciless',
  'Doomhammer', 'Bonecleaver', 'Deathbringer', 'the Conqueror', 'the Tyrant',
  'Hellblade', 'Warborn', 'the Unbroken', 'Ironwill', 'the Dread',
];

const SOLDIER_FIRST = [
  'Grak', 'Thorg', 'Brul', 'Krag', 'Vorn', 'Drek', 'Skarn', 'Grist',
  'Brak', 'Tusk', 'Grond', 'Murg', 'Zog', 'Rag', 'Kurz', 'Darg',
  'Snag', 'Gur', 'Hork', 'Bolg', 'Narg', 'Fug', 'Krug', 'Splug',
];

const SOLDIER_LAST = [
  'Shieldbreaker', 'Ironside', 'Bloodaxe', 'Wartooth', 'Skullsplitter',
  'Bonegrinder', 'the Scarred', 'the Vile', 'Goreclaw', 'Ravager',
  'the Mad', 'Blackhand', 'the Foul', 'Rotgut', 'the Brutal',
];

const randPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const DOCTRINES: Record<string, string> = {
  patrol: 'Hold your position. Fight anyone who approaches. Do not pursue.',
  warband: 'Advance toward enemies. Be aggressive. Protect the group. Attack as a pack.',
  company: 'Form a shield wall. Advance slowly. Block first, counter-attack after. Hold the line.',
  army: 'Coordinate your maniples. Send one group to flank while the main force holds. Protect the centurion. Adapt to the enemy formation.',
  legion: 'Full tactical coordination. Wedge formation to break enemy lines. Reserve one maniple for flanking maneuvers. Protect the centurion at all costs. If losing, regroup and reform shield wall. Learn from each engagement.',
};

/** Spawn a full persistent AI army with Grok brains. */
const spawnAIArmyAction = async (
  tier: string,
  spawnPos: [number, number, number],
  spawnFacing: number,
): Promise<SpawnResult> =>
  tracer.trace('ACTION.ARMY.SPAWN_AI', async () => {
    const sizes: Record<string, number> = { patrol: 3, warband: 5, company: 10, army: 20, legion: 50 };
    const armySize = sizes[tier] || 5;
    const doctrine = DOCTRINES[tier] || DOCTRINES.warband;

    // Create or reuse a system user account
    const username = `ai-army-${Date.now()}-${Math.floor(Math.random() * 999)}`;
    const passwordHash = await passwordHelper.hashPassword(`system-${Date.now()}`);
    const user = await Data.user.create({ username, password_hash: passwordHash });

    // Create the player character (centurion)
    const centurionName = `${randPick(COMMANDER_NAMES)} ${randPick(TITLES)}`;
    await Data.playerCharacter.create({
      user_id: user.id,
      name: centurionName,
      is_npc: false, // This is the "player" character for the AI commander
      strength: rand(15, 25),
      defense: rand(12, 20),
      speed: rand(8, 14),
      max_health: rand(120, 180),
      spawn_x: spawnPos[0],
      spawn_y: spawnPos[1],
      spawn_z: spawnPos[2],
    });

    // Create recruits
    for (let i = 0; i < armySize; i++) {
      const soldierName = `${randPick(SOLDIER_FIRST)} ${randPick(SOLDIER_LAST)}`;
      const npcType = i < armySize * 0.1 ? 'veteran_knight'
        : i < armySize * 0.3 ? 'man_at_arms'
        : 'militia_swordsman';

      const recruit = await Data.playerCharacter.create({
        user_id: user.id,
        name: soldierName,
        is_npc: true,
        commander_id: user.id,
        npc_type: npcType,
        npc_class: 'melee',
        strength: rand(8, 20),
        defense: rand(6, 18),
        speed: rand(6, 12),
        max_health: rand(60, 140),
        max_stamina: 100,
        trait_humor: rand(10, 40),
        trait_obedience: rand(50, 90),
        trait_bravery: rand(40, 90),
        trait_curiosity: rand(5, 30),
        trait_greed: rand(20, 60),
        trait_aggression: rand(50, 90),
        trait_verbosity: rand(10, 40),
        mood: rand(30, 60),
        fear: rand(0, 20),
        loyalty: rand(50, 90),
        spawn_x: spawnPos[0],
        spawn_y: spawnPos[1],
        spawn_z: spawnPos[2],
        ai_agenda: 'seek_combat',
      });

      // Equip weapons based on type
      const weaponNames: Record<string, string> = {
        militia_swordsman: 'Iron Broadsword',
        man_at_arms: 'Steel Rapier',
        veteran_knight: 'War Halberd',
      };
      const shieldTypes = ['militia_swordsman', 'man_at_arms'];

      const weaponDef = await Data.itemDefinition.findByName(weaponNames[npcType] || 'Iron Broadsword');
      if (weaponDef) {
        const wpn = await Data.inventoryItem.addItem(recruit.id, weaponDef.id, 1, 0);
        await Data.inventoryItem.equipItem(wpn.id, 'main_hand').catch(() => {});
      }
      if (shieldTypes.includes(npcType)) {
        const shieldDef = await Data.itemDefinition.findByName('Wooden Shield');
        if (shieldDef) {
          const shld = await Data.inventoryItem.addItem(recruit.id, shieldDef.id, 1, 1);
          await Data.inventoryItem.equipItem(shld.id, 'off_hand').catch(() => {});
        }
      }

      // Auto-assign to army structure
      await Data.playerCharacter.autoAssignRecruit(user.id, recruit.id);
    }

    // Set doctrine on the centurion's instructions
    const centurion = await Data.playerCharacter.findCenturion(user.id);
    if (centurion) {
      await Data.playerCharacter.update(centurion.id, {
        ai_instructions: doctrine,
        ai_agenda: 'seek_combat',
      });
    }

    console.log(`[AI Army] Spawned "${centurionName}" with ${armySize} troops (${tier}) for user ${user.id}`);

    return {
      commander_user_id: user.id,
      commander_username: username,
      army_size: armySize,
      centurion_name: centurionName,
      doctrine,
    };
  });

export default spawnAIArmyAction;
