import prisma from '../../adapters/prisma';

type CreatePanelLogDTO = {
  room_id: string;
  tab: string;
  entry_type: string;
  text: string;
  machine?: string;
};

const create = async (data: CreatePanelLogDTO) => {
  return prisma.panel_log.create({ data });
};

const findRecent = async (roomId: string, tab: string, limit = 150) => {
  const rows = await prisma.panel_log.findMany({
    where: { room_id: roomId, tab },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
  return rows.reverse();
};

export default { create, findRecent };
