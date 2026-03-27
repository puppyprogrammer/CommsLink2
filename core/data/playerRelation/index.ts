import prisma from '../../adapters/prisma';

type Relation = 'enemy' | 'neutral' | 'ally';

/** Get all relations set by a user. */
const findByUser = (userId: string) =>
  prisma.player_relation.findMany({ where: { user_id: userId } });

/** Get the relation between two specific players. */
const findBetween = (userId: string, targetId: string) =>
  prisma.player_relation.findUnique({
    where: { user_id_target_id: { user_id: userId, target_id: targetId } },
  });

/** Set relation (upsert). */
const setRelation = (userId: string, targetId: string, relation: Relation) =>
  prisma.player_relation.upsert({
    where: { user_id_target_id: { user_id: userId, target_id: targetId } },
    create: { user_id: userId, target_id: targetId, relation },
    update: { relation },
  });

/** Remove a relation (resets to neutral implicitly). */
const remove = (userId: string, targetId: string) =>
  prisma.player_relation.delete({
    where: { user_id_target_id: { user_id: userId, target_id: targetId } },
  }).catch(() => null); // Ignore if doesn't exist

/** Get all players who have marked a target as enemy. */
const findEnemiesOf = async (targetId: string): Promise<string[]> => {
  const rows = await prisma.player_relation.findMany({
    where: { target_id: targetId, relation: 'enemy' },
    select: { user_id: true },
  });
  return rows.map((r) => r.user_id);
};

export type { Relation };
export default { findByUser, findBetween, setRelation, remove, findEnemiesOf };
