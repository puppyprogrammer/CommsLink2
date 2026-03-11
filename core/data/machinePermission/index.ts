import prisma from '../../adapters/prisma';

import type { machine_permission } from '../../../prisma/client';

const findByMachineAndRoom = async (machineId: string, roomId: string): Promise<machine_permission | null> =>
  prisma.machine_permission.findUnique({
    where: { machine_id_room_id: { machine_id: machineId, room_id: roomId } },
  });

const findByRoom = async (roomId: string): Promise<machine_permission[]> =>
  prisma.machine_permission.findMany({
    where: { room_id: roomId },
    include: { machine: true },
  });

const findByMachine = async (machineId: string): Promise<machine_permission[]> =>
  prisma.machine_permission.findMany({ where: { machine_id: machineId } });

const upsert = async (machineId: string, roomId: string, enabled: boolean): Promise<machine_permission> =>
  prisma.machine_permission.upsert({
    where: { machine_id_room_id: { machine_id: machineId, room_id: roomId } },
    create: { machine_id: machineId, room_id: roomId, enabled },
    update: { enabled },
  });

const remove = async (machineId: string, roomId: string): Promise<void> => {
  await prisma.machine_permission.deleteMany({
    where: { machine_id: machineId, room_id: roomId },
  });
};

export default { findByMachineAndRoom, findByRoom, findByMachine, upsert, remove };
