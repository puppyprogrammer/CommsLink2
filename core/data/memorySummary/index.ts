import prisma from "../../adapters/prisma";

import type { memory_summary } from "../../../prisma/client";

const create = async (data: {
  room_id: string;
  ref_name: string;
  level: number;
  parent_id?: string;
  content: string;
  msg_start: Date;
  msg_end: Date;
  messages_covered: number;
}): Promise<memory_summary> => prisma.memory_summary.create({ data });

const findByRoomAndRef = async (
  roomId: string,
  refName: string,
): Promise<memory_summary | null> =>
  prisma.memory_summary.findUnique({
    where: { room_id_ref_name: { room_id: roomId, ref_name: refName } },
  });

const findByRoomAndLevel = async (
  roomId: string,
  level: number,
): Promise<memory_summary[]> =>
  prisma.memory_summary.findMany({
    where: { room_id: roomId, level },
    orderBy: { msg_start: "asc" },
  });

const findOrphansByLevel = async (
  roomId: string,
  level: number,
): Promise<memory_summary[]> =>
  prisma.memory_summary.findMany({
    where: { room_id: roomId, level, parent_id: null },
    orderBy: { msg_start: "asc" },
  });

const findMasterByRoom = async (
  roomId: string,
): Promise<memory_summary | null> =>
  prisma.memory_summary.findFirst({ where: { room_id: roomId, level: 4 } });

const setParent = async (ids: string[], parentId: string): Promise<void> => {
  await prisma.memory_summary.updateMany({
    where: { id: { in: ids } },
    data: { parent_id: parentId },
  });
};

const deleteMasterByRoom = async (roomId: string): Promise<void> => {
  await prisma.memory_summary.deleteMany({
    where: { room_id: roomId, level: 4 },
  });
};

const deleteByRoom = async (roomId: string): Promise<void> => {
  await prisma.memory_summary.deleteMany({ where: { room_id: roomId } });
};

export default {
  create,
  findByRoomAndRef,
  findByRoomAndLevel,
  findOrphansByLevel,
  findMasterByRoom,
  setParent,
  deleteMasterByRoom,
  deleteByRoom,
};
