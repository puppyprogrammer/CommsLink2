import prisma from '../../adapters/prisma';

import type { room_invite } from '../../../prisma/client';

/**
 * Create a new room invite.
 *
 * @param roomId    - Room to invite to.
 * @param token     - Unique invite token.
 * @param createdBy - User ID of creator.
 * @param expiresAt - Optional expiry date.
 * @param usesLeft  - Optional use limit.
 * @returns Created invite record.
 */
const create = async (
  roomId: string,
  token: string,
  createdBy: string,
  expiresAt?: Date,
  usesLeft?: number,
): Promise<room_invite> =>
  prisma.room_invite.create({
    data: { room_id: roomId, token, created_by: createdBy, expires_at: expiresAt ?? null, uses_left: usesLeft ?? null },
  });

/**
 * Find an invite by token.
 *
 * @param token - Invite token string.
 * @returns Invite or null.
 */
const findByToken = async (token: string): Promise<room_invite | null> =>
  prisma.room_invite.findUnique({ where: { token } });

/**
 * Find all invites for a room.
 *
 * @param roomId - Room UUID.
 * @returns Invite records.
 */
const findByRoom = async (roomId: string): Promise<room_invite[]> =>
  prisma.room_invite.findMany({ where: { room_id: roomId }, orderBy: { created_at: 'desc' } });

/**
 * Decrement uses_left by 1. Deletes invite if uses_left reaches 0.
 *
 * @param id - Invite UUID.
 */
const consumeUse = async (id: string): Promise<void> => {
  const invite = await prisma.room_invite.findUnique({ where: { id } });
  if (!invite || invite.uses_left === null) return;
  if (invite.uses_left <= 1) {
    await prisma.room_invite.delete({ where: { id } });
  } else {
    await prisma.room_invite.update({ where: { id }, data: { uses_left: invite.uses_left - 1 } });
  }
};

/**
 * Delete an invite by ID.
 *
 * @param id - Invite UUID.
 */
const deleteById = async (id: string): Promise<void> => {
  await prisma.room_invite.delete({ where: { id } });
};

export default { create, findByToken, findByRoom, consumeUse, deleteById };
