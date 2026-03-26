import prisma from '../../adapters/prisma';
import type { shop_transaction } from '../../../prisma/client';

const create = async (data: {
  shop_id: string;
  character_id: string;
  item_def_id: string;
  quantity: number;
  total_price: number;
  type: string;
}): Promise<shop_transaction> =>
  prisma.shop_transaction.create({ data });

const findByShop = async (shopId: string, limit: number = 50) =>
  prisma.shop_transaction.findMany({
    where: { shop_id: shopId },
    orderBy: { created_at: 'desc' },
    take: limit,
    include: { item_def: true },
  });

const findByCharacter = async (characterId: string, limit: number = 50) =>
  prisma.shop_transaction.findMany({
    where: { character_id: characterId },
    orderBy: { created_at: 'desc' },
    take: limit,
    include: { item_def: true, shop: true },
  });

export default { create, findByShop, findByCharacter };
