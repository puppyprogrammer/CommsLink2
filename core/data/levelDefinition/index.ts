import prisma from '../../adapters/prisma';
import type { level_definition } from '../../../prisma/client';

const findAll = async (): Promise<level_definition[]> =>
  prisma.level_definition.findMany({ orderBy: { level: 'asc' } });

const findByLevel = async (level: number): Promise<level_definition | null> =>
  prisma.level_definition.findUnique({ where: { level } });

const getMaxLevel = async (): Promise<number> => {
  const max = await prisma.level_definition.findFirst({ orderBy: { level: 'desc' } });
  return max?.level ?? 1;
};

const upsert = async (data: { level: number; xp_required: number }): Promise<level_definition> =>
  prisma.level_definition.upsert({
    where: { level: data.level },
    create: data,
    update: data,
  });

export default { findAll, findByLevel, getMaxLevel, upsert };
