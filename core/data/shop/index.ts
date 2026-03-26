import prisma from '../../adapters/prisma';
import type { shop } from '../../../prisma/client';

const create = async (data: { name: string; display_name: string; shop_type: string; description?: string; buy_markup?: number; sell_discount?: number }): Promise<shop> =>
  prisma.shop.create({ data });

const findById = async (id: string): Promise<shop | null> =>
  prisma.shop.findUnique({ where: { id } });

const findByName = async (name: string): Promise<shop | null> =>
  prisma.shop.findUnique({ where: { name } });

const findAll = async (): Promise<shop[]> =>
  prisma.shop.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } });

export default { create, findById, findByName, findAll };
