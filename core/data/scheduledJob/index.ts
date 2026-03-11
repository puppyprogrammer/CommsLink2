import prisma from '../../adapters/prisma';

import type { scheduled_job } from '../../../prisma/client';

type CreateScheduledJobDTO = {
  agent_id: string;
  room_id: string;
  creator_id: string;
  message: string;
  run_at: Date;
  recurrence?: string;
  recur_time?: string;
  recur_weekday?: number;
};

type UpdateScheduledJobDTO = {
  status?: string;
  run_at?: Date;
  last_fired_at?: Date;
};

const create = async (data: CreateScheduledJobDTO): Promise<scheduled_job> =>
  prisma.scheduled_job.create({ data });

const findById = async (id: string): Promise<scheduled_job | null> =>
  prisma.scheduled_job.findUnique({ where: { id } });

const findActiveByAgent = async (agentId: string): Promise<scheduled_job[]> =>
  prisma.scheduled_job.findMany({ where: { agent_id: agentId, status: 'active' }, orderBy: { run_at: 'asc' } });

const findActiveByRoom = async (roomId: string): Promise<scheduled_job[]> =>
  prisma.scheduled_job.findMany({ where: { room_id: roomId, status: 'active' }, orderBy: { run_at: 'asc' } });

const findDueJobs = async (now: Date): Promise<scheduled_job[]> =>
  prisma.scheduled_job.findMany({ where: { status: 'active', run_at: { lte: now } } });

const update = async (id: string, data: UpdateScheduledJobDTO): Promise<scheduled_job> =>
  prisma.scheduled_job.update({ where: { id }, data });

const cancel = async (id: string): Promise<scheduled_job> =>
  prisma.scheduled_job.update({ where: { id }, data: { status: 'cancelled' } });

const cancelByAgentAndMessage = async (agentId: string, messagePart: string): Promise<number> => {
  const result = await prisma.scheduled_job.updateMany({
    where: { agent_id: agentId, status: 'active', message: { contains: messagePart } },
    data: { status: 'cancelled' },
  });
  return result.count;
};

export default { create, findById, findActiveByAgent, findActiveByRoom, findDueJobs, update, cancel, cancelByAgentAndMessage };
