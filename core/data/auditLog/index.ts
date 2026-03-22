import prisma from '../../adapters/prisma';

const create = async (data: {
  event: string;
  username: string;
  ip_address?: string;
  details?: string;
}) => prisma.audit_log.create({ data });

const findRecent = async (limit = 100) =>
  prisma.audit_log.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
  });

export default { create, findRecent };
