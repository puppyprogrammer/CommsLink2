import prisma from '../../adapters/prisma';

import type { Prisma } from '../../../prisma/client';
import type { fight_event } from '../../../prisma/client';

type CreateFightEventDTO = {
  fight_id: string;
  timestamp_ms: number;
  actor_gladiator_id: string;
  action: string;
  result: string;
  damage_dealt?: number;
  stamina_cost?: number;
  health_after_actor: number;
  health_after_target: number;
  stamina_after_actor?: number;
  stamina_after_target?: number;
  ai_reasoning?: string;
  position_actor?: Prisma.InputJsonValue;
  position_target?: Prisma.InputJsonValue;
};

/**
 * Create a fight event.
 *
 * @param data - Event data.
 * @returns Created event.
 */
const create = async (data: CreateFightEventDTO): Promise<fight_event> =>
  prisma.fight_event.create({ data });

/**
 * Create multiple fight events in bulk.
 *
 * @param events - Array of event data.
 * @returns Count of created events.
 */
const createMany = async (events: CreateFightEventDTO[]): Promise<{ count: number }> =>
  prisma.fight_event.createMany({ data: events });

/**
 * Find all events for a fight, ordered by timestamp.
 *
 * @param fightId - Fight ID.
 * @returns Ordered fight events.
 */
const findByFight = async (fightId: string): Promise<fight_event[]> =>
  prisma.fight_event.findMany({
    where: { fight_id: fightId },
    orderBy: { timestamp_ms: 'asc' },
  });

export default { create, createMany, findByFight };
