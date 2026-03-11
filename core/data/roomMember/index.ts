import prisma from '../../adapters/prisma';

import type { room_member } from '../../../prisma/client';

type RoomMemberWithUser = room_member & { user: { username: string } };

const findByRoomAndUser = async (roomId: string, userId: string): Promise<room_member | null> =>
  prisma.room_member.findUnique({ where: { room_id_user_id: { room_id: roomId, user_id: userId } } });

const findByRoom = async (roomId: string): Promise<RoomMemberWithUser[]> =>
  prisma.room_member.findMany({
    where: { room_id: roomId },
    include: { user: { select: { username: true } } },
    orderBy: { created_at: 'asc' },
  });

const findByUser = async (userId: string): Promise<room_member[]> =>
  prisma.room_member.findMany({ where: { user_id: userId } });

const addMember = async (roomId: string, userId: string, role = 'member'): Promise<room_member> =>
  prisma.room_member.upsert({
    where: { room_id_user_id: { room_id: roomId, user_id: userId } },
    update: { role },
    create: { room_id: roomId, user_id: userId, role },
  });

const setRole = async (roomId: string, userId: string, role: string): Promise<room_member> =>
  prisma.room_member.update({
    where: { room_id_user_id: { room_id: roomId, user_id: userId } },
    data: { role },
  });

const removeMember = async (roomId: string, userId: string): Promise<void> => {
  await prisma.room_member.deleteMany({ where: { room_id: roomId, user_id: userId } });
};

export default { findByRoomAndUser, findByRoom, findByUser, addMember, setRole, removeMember };
