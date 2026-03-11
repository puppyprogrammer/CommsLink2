import prisma from '../../adapters/prisma';

import type { daily_stats } from '../../../prisma/client';

/**
 * Increment visit count for a date.
 *
 * @param date - Date string (YYYY-MM-DD).
 */
const incrementVisits = async (date: string): Promise<void> => {
  await prisma.daily_stats.upsert({
    where: { date },
    create: { date, visits: 1, messages_sent: 0 },
    update: { visits: { increment: 1 } },
  });
};

/**
 * Increment message count for a date.
 *
 * @param date - Date string (YYYY-MM-DD).
 */
const incrementMessages = async (date: string): Promise<void> => {
  await prisma.daily_stats.upsert({
    where: { date },
    create: { date, visits: 0, messages_sent: 1 },
    update: { messages_sent: { increment: 1 } },
  });
};

/**
 * Get recent daily stats.
 *
 * @param days - Number of days to retrieve.
 * @returns Stats ordered by date descending.
 */
const getRecent = async (days: number): Promise<daily_stats[]> =>
  prisma.daily_stats.findMany({
    orderBy: { date: 'desc' },
    take: days,
  });

export default { incrementVisits, incrementMessages, getRecent };
