import prisma from '../../adapters/prisma';

import type { app_version } from '../../../prisma/client';

/**
 * Create a version record (ignore if duplicate).
 *
 * @param version - Version number.
 * @param message - Release message.
 * @returns Created version or existing.
 */
const create = async (version: number, message: string): Promise<app_version> =>
  prisma.app_version.upsert({
    where: { version },
    create: { version, message },
    update: {},
  });

/**
 * Get all versions ordered by version descending.
 *
 * @returns Version history.
 */
const findAll = async (): Promise<app_version[]> =>
  prisma.app_version.findMany({ orderBy: { version: 'desc' } });

export default { create, findAll };
