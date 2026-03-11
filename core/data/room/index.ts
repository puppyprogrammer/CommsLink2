import prisma from "../../adapters/prisma";

import type { CreateRoomDTO } from "../../interfaces/room";
import type { room } from "../../../prisma/client";

/**
 * Create a new room.
 *
 * @param data - Room creation fields.
 * @returns Created room record.
 */
const create = async (data: CreateRoomDTO): Promise<room> =>
  prisma.room.create({ data });

/**
 * Find room by normalized name.
 *
 * @param name - Lowercase room name.
 * @returns Room or null.
 */
const findByName = async (name: string): Promise<room | null> =>
  prisma.room.findUnique({ where: { name } });

/**
 * Get all persisted rooms.
 *
 * @returns All room records.
 */
const findAll = async (): Promise<room[]> =>
  prisma.room.findMany({ orderBy: { created_at: "asc" } });

/**
 * Delete a room by name.
 *
 * @param name - Lowercase room name.
 */
const deleteByName = async (name: string): Promise<void> => {
  await prisma.room.delete({ where: { name } });
};

const findById = async (id: string): Promise<room | null> =>
  prisma.room.findUnique({ where: { id } });

const updateMemoryEnabled = async (
  id: string,
  enabled: boolean,
): Promise<room> =>
  prisma.room.update({ where: { id }, data: { memory_enabled: enabled } });

const updateCommandSettings = async (
  id: string,
  data: { cmd_recall_enabled?: boolean; cmd_sql_enabled?: boolean; cmd_memory_enabled?: boolean; cmd_selfmod_enabled?: boolean; cmd_autopilot_enabled?: boolean; cmd_web_enabled?: boolean; cmd_mentions_enabled?: boolean; cmd_terminal_enabled?: boolean; cmd_claude_enabled?: boolean; cmd_schedule_enabled?: boolean; cmd_tokens_enabled?: boolean; cmd_moderation_enabled?: boolean; cmd_think_enabled?: boolean; cmd_effort_enabled?: boolean; cmd_audit_enabled?: boolean; cmd_continue_enabled?: boolean; max_loops?: number },
): Promise<room> => prisma.room.update({ where: { id }, data });

export default {
  create,
  findByName,
  findAll,
  deleteByName,
  findById,
  updateMemoryEnabled,
  updateCommandSettings,
};
