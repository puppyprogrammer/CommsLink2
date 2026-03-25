import prisma from '../../adapters/prisma';
import type { item_definition } from '../../../prisma/client';

const findAll = async (): Promise<item_definition[]> =>
  prisma.item_definition.findMany({ orderBy: { name: 'asc' } });

const findById = async (id: string): Promise<item_definition | null> =>
  prisma.item_definition.findUnique({ where: { id } });

const findByName = async (name: string): Promise<item_definition | null> =>
  prisma.item_definition.findUnique({ where: { name } });

const findByType = async (itemType: string): Promise<item_definition[]> =>
  prisma.item_definition.findMany({ where: { item_type: itemType }, orderBy: { name: 'asc' } });

const create = async (data: Omit<item_definition, 'id' | 'created_at'>): Promise<item_definition> =>
  prisma.item_definition.create({ data });

const upsertByName = async (data: Omit<item_definition, 'id' | 'created_at'>): Promise<item_definition> =>
  prisma.item_definition.upsert({
    where: { name: data.name },
    create: data,
    update: data,
  });

export default { findAll, findById, findByName, findByType, create, upsertByName };
