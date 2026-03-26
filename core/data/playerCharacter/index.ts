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

/** Auto-assign a new recruit to the army structure. */
const autoAssignRecruit = async (commanderId: string, recruitId: string, rank: string): Promise<player_character> => {
  const army = await getArmyStructure(commanderId);

  // If centurion, just assign
  if (rank === 'centurion') {
    return prisma.player_character.update({
      where: { id: recruitId },
      data: { rank: 'centurion', maniple_id: null, squad_id: null },
    });
  }

  // Find smallest maniple and squad
  const manipleSlots: Record<number, Record<string, number>> = {};
  for (let m = 1; m <= 10; m++) {
    manipleSlots[m] = { a: 0, b: 0 };
  }
  for (const unit of army) {
    if (unit.maniple_id && unit.squad_id) {
      manipleSlots[unit.maniple_id][unit.squad_id]++;
    }
  }

  // Find smallest squad
  let bestManiple = 1;
  let bestSquad = 'a';
  let bestCount = 999;
  for (let m = 1; m <= 10; m++) {
    for (const s of ['a', 'b']) {
      if (manipleSlots[m][s] < bestCount) {
        bestCount = manipleSlots[m][s];
        bestManiple = m;
        bestSquad = s;
      }
    }
  }

  // Auto-generate maniple name if first unit in this maniple
  const manipleUnits = army.filter(u => u.maniple_id === bestManiple);
  const manipleNames = ['Iron Guard', 'Wolf Pack', 'Red Company', 'Black Watch', 'Storm Riders',
    'Shield Wall', 'Vanguard', 'Night Owls', 'Ember Fist', 'Stone Legion'];
  const manipuleName = manipleUnits.length > 0 ? manipleUnits[0].maniple_name : manipleNames[bestManiple - 1];

  return prisma.player_character.update({
    where: { id: recruitId },
    data: {
      rank,
      maniple_id: bestManiple,
      maniple_name: manipuleName,
      squad_id: bestSquad,
    },
  });
};

export default {
  create, findById, findByUserId, update, addXP, recordKill, recordDeath, updateSpawn,
  findRecruitsByCommander, deleteRecruit, getArmyStructure, findCenturion, findByManiple,
  findBySquad, findByRank, autoAssignRecruit,
};
