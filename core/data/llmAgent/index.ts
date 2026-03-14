import prisma from '../../adapters/prisma';

import type { llm_agent } from '../../../prisma/client';

type CreateAgentDTO = {
  name: string;
  room_id: string;
  creator_id: string;
  voice_id?: string;
  model?: string;
  system_instructions?: string;
  memories?: string;
  autopilot_enabled?: boolean;
  autopilot_interval?: number;
  autopilot_prompts?: string;
  nicknames?: string;
  max_tokens?: number;
};

type UpdateAgentDTO = {
  name?: string;
  voice_id?: string;
  model?: string;
  system_instructions?: string | null;
  memories?: string | null;
  autopilot_enabled?: boolean;
  autopilot_interval?: number;
  autopilot_prompts?: string | null;
  plan?: string | null;
  tasks?: string | null;
  nicknames?: string | null;
  max_tokens?: number;
};

const create = async (data: CreateAgentDTO): Promise<llm_agent> =>
  prisma.llm_agent.create({ data });

const findById = async (id: string): Promise<llm_agent | null> =>
  prisma.llm_agent.findUnique({ where: { id } });

const findByRoom = async (roomId: string): Promise<llm_agent[]> =>
  prisma.llm_agent.findMany({ where: { room_id: roomId } });

const findAutopilotEnabled = async (): Promise<llm_agent[]> =>
  prisma.llm_agent.findMany({ where: { autopilot_enabled: true } });

const findAutopilotDisabled = async (): Promise<llm_agent[]> =>
  prisma.llm_agent.findMany({ where: { autopilot_enabled: false } });

const update = async (id: string, data: UpdateAgentDTO): Promise<llm_agent> =>
  prisma.llm_agent.update({ where: { id }, data });

const remove = async (id: string): Promise<llm_agent> =>
  prisma.llm_agent.delete({ where: { id } });

const countByRoom = async (roomId: string): Promise<number> =>
  prisma.llm_agent.count({ where: { room_id: roomId } });

export default { create, findById, findByRoom, findAutopilotEnabled, findAutopilotDisabled, update, remove, countByRoom };
