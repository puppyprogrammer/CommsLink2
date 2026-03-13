import prisma from '../../adapters/prisma';

import type { watchlist_item, WatchStatus } from '../../../prisma/client';

type CreateWatchlistItemDTO = {
  user_id: string;
  video_id: string;
  title?: string;
  channel?: string;
  thumbnail?: string;
  duration?: string;
};

const create = async (data: CreateWatchlistItemDTO): Promise<watchlist_item> =>
  prisma.watchlist_item.create({ data });

const findByUser = async (
  userId: string,
  status?: WatchStatus,
): Promise<watchlist_item[]> =>
  prisma.watchlist_item.findMany({
    where: { user_id: userId, ...(status ? { status } : {}) },
    orderBy: { added_at: 'desc' },
  });

const findByUserAndVideo = async (
  userId: string,
  videoId: string,
): Promise<watchlist_item | null> =>
  prisma.watchlist_item.findFirst({
    where: { user_id: userId, video_id: videoId },
  });

const updateStatus = async (
  userId: string,
  videoId: string,
  status: WatchStatus,
): Promise<watchlist_item> =>
  prisma.watchlist_item.update({
    where: { video_id: videoId },
    data: { status },
  });

const remove = async (userId: string, videoId: string): Promise<watchlist_item> =>
  prisma.watchlist_item.delete({
    where: { video_id: videoId },
  });

export type { CreateWatchlistItemDTO };
export default { create, findByUser, findByUserAndVideo, updateStatus, remove };
