import prisma from '../../adapters/prisma';
import type { player_character } from '../../../prisma/client';

const XP_PER_LEVEL = 100;
const HP_PER_LEVEL = 2;
const STAT_PER_LEVEL = 1;

const create = async (data: Record<string, unknown> & { user_id: string; name: string }): Promise<player_character> =>
  prisma.player_character.create({ data: data as Parameters<typeof prisma.player_character.create>[0]['data'] });

const findById = async (id: string): Promise<player_character | null> =>
  prisma.player_character.findUnique({ where: { id } });

/** Find a real player's character (not NPC) by user ID. */
const findByUserId = async (userId: string): Promise<player_character | null> =>
  prisma.player_character.findFirst({ where: { user_id: userId, is_npc: false } });

const update = async (id: string, data: Record<string, unknown>): Promise<player_character> =>
  prisma.player_character.update({ where: { id }, data });

/** Add XP and handle level-ups. Each level = 100 XP, grants +2 HP, +1 str/def/spd. */
const addXP = async (id: string, amount: number): Promise<player_character> => {
  const char = await prisma.player_character.update({
    where: { id },
    data: { xp: { increment: amount } },
  });

  const newLevel = Math.floor(char.xp / XP_PER_LEVEL) + 1;
  if (newLevel > char.level) {
    const levelsGained = newLevel - char.level;
    return prisma.player_character.update({
      where: { id },
      data: {
        level: newLevel,
        max_health: { increment: levelsGained * HP_PER_LEVEL },
        strength: { increment: levelsGained * STAT_PER_LEVEL },
        defense: { increment: levelsGained * STAT_PER_LEVEL },
        speed: { increment: levelsGained * STAT_PER_LEVEL },
      },
    });
  }

  return char;
};

const recordKill = async (id: string): Promise<player_character> =>
  prisma.player_character.update({ where: { id }, data: { kills: { increment: 1 } } });

const recordDeath = async (id: string): Promise<player_character> =>
  prisma.player_character.update({ where: { id }, data: { deaths: { increment: 1 } } });

const updateSpawn = async (id: string, x: number, y: number, z: number): Promise<player_character> =>
  prisma.player_character.update({ where: { id }, data: { spawn_x: x, spawn_y: y, spawn_z: z } });

/** Get all recruits (NPCs) commanded by a user. */
const findRecruitsByCommander = async (userId: string): Promise<player_character[]> =>
  prisma.player_character.findMany({
    where: { commander_id: userId, is_npc: true },
    orderBy: { created_at: 'asc' },
  });

/** Dismiss (delete) a recruit. */
const deleteRecruit = async (id: string): Promise<void> => {
  await prisma.player_character.delete({ where: { id } });
};

/** Get full army structure for a commander, ordered by rank and assignment. */
const getArmyStructure = async (commanderId: string): Promise<player_character[]> =>
  prisma.player_character.findMany({
    where: { commander_id: commanderId, is_npc: true },
    orderBy: [
      { rank: 'desc' },
      { maniple_id: 'asc' },
      { squad_id: 'asc' },
      { created_at: 'asc' },
    ],
  });

/** Find the centurion for a commander. */
const findCenturion = async (commanderId: string): Promise<player_character | null> =>
  prisma.player_character.findFirst({
    where: { commander_id: commanderId, is_npc: true, rank: 'centurion' },
  });

/** Find units by maniple. */
const findByManiple = async (commanderId: string, manipleId: number): Promise<player_character[]> =>
  prisma.player_character.findMany({
    where: { commander_id: commanderId, is_npc: true, maniple_id: manipleId },
    orderBy: [{ rank: 'desc' }, { squad_id: 'asc' }],
  });

/** Find units by squad. */
const findBySquad = async (commanderId: string, manipleId: number, squadId: string): Promise<player_character[]> =>
  prisma.player_character.findMany({
    where: { commander_id: commanderId, is_npc: true, maniple_id: manipleId, squad_id: squadId },
    orderBy: [{ rank: 'desc' }],
  });

/** Find units by rank. */
const findByRank = async (commanderId: string, rank: string): Promise<player_character[]> =>
  prisma.player_character.findMany({
    where: { commander_id: commanderId, is_npc: true, rank },
    orderBy: [{ maniple_id: 'asc' }, { squad_id: 'asc' }],
  });

const MANIPLE_NAMES = ['Iron Guard', 'Wolf Pack', 'Red Company', 'Black Watch', 'Storm Riders',
  'Shield Wall', 'Vanguard', 'Night Owls', 'Ember Fist', 'Stone Legion'];
const SQUAD_SIZE = 5;

/**
 * Auto-assign a new recruit to the army. All recruits start as Soldier.
 * Fills squads sequentially: 1A → 1B → 2A → 2B → etc.
 * Auto-promotes the highest XP unit when a leadership slot needs filling.
 */
const autoAssignRecruit = async (commanderId: string, recruitId: string): Promise<player_character> => {
  // Exclude the new recruit from the army count (it was just created)
  const army = (await getArmyStructure(commanderId)).filter((u) => u.id !== recruitId);
  const armySize = army.length; // NOT including the new recruit

  // ── First recruit ever → Centurion ──
  if (armySize === 0) {
    return prisma.player_character.update({
      where: { id: recruitId },
      data: { rank: 'centurion', maniple_id: null, maniple_name: null, squad_id: null },
    });
  }

  // ── Find the next open slot (sequential fill) ──
  // Count units per squad (excluding centurion)
  const squadCounts: Record<string, number> = {};
  for (const unit of army) {
    if (unit.rank === 'centurion' || !unit.maniple_id || !unit.squad_id) continue;
    const key = `${unit.maniple_id}_${unit.squad_id}`;
    squadCounts[key] = (squadCounts[key] || 0) + 1;
  }

  // Find the first squad that isn't full (sequential: 1a, 1b, 2a, 2b, ...)
  let targetManiple = 1;
  let targetSquad = 'a';
  let needsNewSquad = false;
  let needsNewManiple = false;

  for (let m = 1; m <= 10; m++) {
    for (const s of ['a', 'b']) {
      const key = `${m}_${s}`;
      const count = squadCounts[key] || 0;
      if (count < SQUAD_SIZE) {
        targetManiple = m;
        targetSquad = s;
        // Is this squad brand new?
        needsNewSquad = count === 0;
        // Is this maniple brand new?
        const manipleTotal = (squadCounts[`${m}_a`] || 0) + (squadCounts[`${m}_b`] || 0);
        needsNewManiple = manipleTotal === 0;

        // Found the slot, break out
        m = 99; // break outer
        break;
      }
    }
  }

  const manipuleName = MANIPLE_NAMES[targetManiple - 1] || `Maniple ${targetManiple}`;

  // ── Handle auto-promotions ──

  // If this is the first unit in a new maniple (not maniple 1), promote a Sergeant → Decurion
  if (needsNewManiple && targetManiple > 1) {
    await autoPromote(commanderId, army, 'sergeant', 'decurion', targetManiple, null);
  }

  // If this is the first unit in a new squad, the new recruit fills as Soldier,
  // and the highest-XP Soldier from the same maniple gets promoted to Sergeant.
  // Exception: very first squad (1a) — the 2nd recruit overall becomes Sergeant directly.
  if (needsNewSquad) {
    if (armySize === 1) {
      // 2nd recruit: becomes Sergeant of Squad 1A
      return prisma.player_character.update({
        where: { id: recruitId },
        data: { rank: 'sergeant', maniple_id: targetManiple, maniple_name: manipuleName, squad_id: targetSquad },
      });
    }

    // For new squads after the first: promote highest XP soldier from the maniple
    await autoPromote(commanderId, army, 'soldier', 'sergeant', targetManiple, targetSquad);
  }

  // ── Assign the new recruit as Soldier ──
  return prisma.player_character.update({
    where: { id: recruitId },
    data: { rank: 'soldier', maniple_id: targetManiple, maniple_name: manipuleName, squad_id: targetSquad },
  });
};

/** Auto-promote the best candidate to fill a leadership gap. */
const autoPromote = async (
  commanderId: string,
  army: player_character[],
  fromRank: string,
  toRank: string,
  targetManiple: number | null,
  targetSquad: string | null,
): Promise<void> => {
  // Find candidates — prefer from same maniple, highest XP, then oldest
  let candidates = army.filter((u) => u.rank === fromRank && u.is_alive);

  // Prefer same maniple if applicable
  if (targetManiple) {
    const sameManiple = candidates.filter((u) => u.maniple_id === targetManiple);
    if (sameManiple.length > 0) candidates = sameManiple;
  }

  // Sort by XP desc, then created_at asc (longest service as tiebreak)
  candidates.sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    return a.created_at.getTime() - b.created_at.getTime();
  });

  const promoted = candidates[0];
  if (!promoted) return;

  const updateData: Record<string, unknown> = { rank: toRank };
  if (targetManiple) updateData.maniple_id = targetManiple;
  if (targetSquad) updateData.squad_id = targetSquad;
  updateData.maniple_name = MANIPLE_NAMES[(targetManiple || 1) - 1];

  await prisma.player_character.update({ where: { id: promoted.id }, data: updateData });
  console.log(`[Army] Auto-promoted ${promoted.name} from ${fromRank} to ${toRank} (XP: ${promoted.xp})`);
};

export default {
  create, findById, findByUserId, update, addXP, recordKill, recordDeath, updateSpawn,
  findRecruitsByCommander, deleteRecruit, getArmyStructure, findCenturion, findByManiple,
  findBySquad, findByRank, autoAssignRecruit,
};
