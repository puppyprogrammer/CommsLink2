import prisma from '../../adapters/prisma';
import type { player_character } from '../../../prisma/client';

const XP_PER_LEVEL = 100;
const HP_PER_LEVEL = 2;
const STAT_PER_LEVEL = 1;

const create = async (data: {
  user_id: string;
  name: string;
  is_npc?: boolean;
  commander_id?: string;
  npc_type?: string;
  npc_class?: string;
  strength?: number;
  defense?: number;
  speed?: number;
  max_health?: number;
  max_stamina?: number;
}): Promise<player_character> =>
  prisma.player_character.create({ data });

const findById = async (id: string): Promise<player_character | null> =>
  prisma.player_character.findUnique({ where: { id } });

/** Find a real player's character (not NPC) by user ID. */
const findByUserId = async (userId: string): Promise<player_character | null> =>
  prisma.player_character.findFirst({ where: { user_id: userId, is_npc: false } });

const update = async (id: string, data: Partial<{
  name: string;
  level: number;
  xp: number;
  max_health: number;
  max_stamina: number;
  strength: number;
  defense: number;
  speed: number;
  is_alive: boolean;
}>): Promise<player_character> =>
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

export default { create, findById, findByUserId, update, addXP, recordKill, recordDeath, updateSpawn, findRecruitsByCommander, deleteRecruit };
