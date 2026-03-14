import prisma from '../../adapters/prisma';

import type { hologram_avatar } from '../../../prisma/client';

type CreateAvatarDTO = {
  room_id: string;
  user_id: string;
  label: string;
  skeleton: unknown;
  points: unknown;
  pose?: unknown;
  physics?: boolean;
};

type UpdateAvatarDTO = {
  label?: string;
  skeleton?: unknown;
  points?: unknown;
  pose?: unknown;
  morph_targets?: unknown;
  ppo_weights?: unknown;
  physics?: boolean;
};

const create = async (data: CreateAvatarDTO): Promise<hologram_avatar> =>
  prisma.hologram_avatar.create({ data: data as Parameters<typeof prisma.hologram_avatar.create>[0]['data'] });

const findById = async (id: string): Promise<hologram_avatar | null> =>
  prisma.hologram_avatar.findUnique({ where: { id } });

const findByRoom = async (roomId: string): Promise<hologram_avatar[]> =>
  prisma.hologram_avatar.findMany({ where: { room_id: roomId } });

const findByRoomAndUser = async (roomId: string, userId: string): Promise<hologram_avatar | null> =>
  prisma.hologram_avatar.findUnique({ where: { room_id_user_id: { room_id: roomId, user_id: userId } } });

const update = async (id: string, data: UpdateAvatarDTO): Promise<hologram_avatar> =>
  prisma.hologram_avatar.update({
    where: { id },
    data: data as Parameters<typeof prisma.hologram_avatar.update>[0]['data'],
  });

const updatePose = async (id: string, pose: unknown): Promise<hologram_avatar> =>
  prisma.hologram_avatar.update({
    where: { id },
    data: { pose: pose as Parameters<typeof prisma.hologram_avatar.update>[0]['data']['pose'] },
  });

const updatePpoWeights = async (id: string, ppoWeights: unknown): Promise<hologram_avatar> =>
  prisma.hologram_avatar.update({
    where: { id },
    data: { ppo_weights: ppoWeights as Parameters<typeof prisma.hologram_avatar.update>[0]['data']['ppo_weights'] },
  });

const remove = async (id: string): Promise<hologram_avatar> => prisma.hologram_avatar.delete({ where: { id } });

const removeByRoomAndUser = async (roomId: string, userId: string): Promise<hologram_avatar> =>
  prisma.hologram_avatar.delete({ where: { room_id_user_id: { room_id: roomId, user_id: userId } } });

export default { create, findById, findByRoom, findByRoomAndUser, update, updatePose, updatePpoWeights, remove, removeByRoomAndUser };
