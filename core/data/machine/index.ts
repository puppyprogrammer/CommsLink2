import prisma from '../../adapters/prisma';

import type { machine } from '../../../prisma/client';

type CreateMachineDTO = {
  name: string;
  owner_id: string;
  os?: string;
};

type UpdateMachineDTO = {
  socket_id?: string | null;
  status?: string;
  os?: string;
  last_seen?: Date;
};

const create = async (data: CreateMachineDTO): Promise<machine> =>
  prisma.machine.create({ data });

const findById = async (id: string): Promise<machine | null> =>
  prisma.machine.findUnique({ where: { id } });

const findByOwner = async (ownerId: string): Promise<machine[]> =>
  prisma.machine.findMany({ where: { owner_id: ownerId }, orderBy: { created_at: 'asc' } });

const findByOwnerAndName = async (ownerId: string, name: string): Promise<machine | null> =>
  prisma.machine.findUnique({ where: { owner_id_name: { owner_id: ownerId, name } } });

const findOnlineByOwner = async (ownerId: string): Promise<machine[]> =>
  prisma.machine.findMany({ where: { owner_id: ownerId, status: 'online' } });

const update = async (id: string, data: UpdateMachineDTO): Promise<machine> =>
  prisma.machine.update({ where: { id }, data });

const remove = async (id: string): Promise<machine> =>
  prisma.machine.delete({ where: { id } });

const setOfflineBySocketId = async (socketId: string): Promise<void> => {
  await prisma.machine.updateMany({
    where: { socket_id: socketId },
    data: { status: 'offline', socket_id: null, last_seen: new Date() },
  });
};

const setAllOffline = async (): Promise<void> => {
  await prisma.machine.updateMany({
    where: { status: 'online' },
    data: { status: 'offline', socket_id: null, last_seen: new Date() },
  });
};

export default { create, findById, findByOwner, findByOwnerAndName, findOnlineByOwner, update, remove, setOfflineBySocketId, setAllOffline };
