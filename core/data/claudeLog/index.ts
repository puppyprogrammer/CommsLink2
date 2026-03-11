import prisma from '../../adapters/prisma';

type CreateClaudeLogDTO = {
  direction: string;
  session_key: string;
  machine_name: string;
  username: string;
  room_name: string;
  content: string;
};

const create = async (data: CreateClaudeLogDTO) => {
  return prisma.claude_log.create({ data });
};

const findBySessionKey = async (sessionKey: string, limit = 50) => {
  return prisma.claude_log.findMany({
    where: { session_key: sessionKey },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
};

const findRecent = async (limit = 100) => {
  return prisma.claude_log.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
  });
};

export default { create, findBySessionKey, findRecent };
