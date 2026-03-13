import prisma from '../../adapters/prisma';

import type { agent_template } from '../../../prisma/client';

const findAll = async (): Promise<agent_template[]> =>
  prisma.agent_template.findMany({ orderBy: { name: 'asc' } });

const findById = async (id: string): Promise<agent_template | null> =>
  prisma.agent_template.findUnique({ where: { id } });

export default { findAll, findById };
