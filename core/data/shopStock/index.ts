import prisma from '../../adapters/prisma';
import type { shop_stock } from '../../../prisma/client';

const create = async (data: { shop_id: string; item_def_id: string; quantity?: number; price_override?: number }): Promise<shop_stock> =>
  prisma.shop_stock.create({ data });

const findByShop = async (shopId: string) =>
  prisma.shop_stock.findMany({
    where: { shop_id: shopId },
    include: { item_def: true },
    orderBy: { item_def: { name: 'asc' } },
  });

const findByShopAndItem = async (shopId: string, itemDefId: string): Promise<shop_stock | null> =>
  prisma.shop_stock.findUnique({
    where: { shop_id_item_def_id: { shop_id: shopId, item_def_id: itemDefId } },
  });

const update = async (id: string, data: Partial<{ quantity: number; price_override: number }>): Promise<shop_stock> =>
  prisma.shop_stock.update({ where: { id }, data });

const remove = async (id: string): Promise<void> => {
  await prisma.shop_stock.delete({ where: { id } });
};

export default { create, findByShop, findByShopAndItem, update, remove };
