import tracer from '../../lib/tracer';

import Data from '../../data';

import type { DashboardData } from '../../interfaces/stats';

/**
 * Get admin dashboard data.
 *
 * @returns Users list and recent stats.
 */
const getDashboardAction = async (): Promise<DashboardData> =>
  tracer.trace('ACTION.ADMIN.GET_DASHBOARD', async () => {
    const users = await Data.user.findAll();
    const stats = await Data.dailyStats.getRecent(30);

    return { users, stats };
  });

export default getDashboardAction;
