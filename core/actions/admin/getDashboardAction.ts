import tracer from '../../lib/tracer';

import Data from '../../data';

import type { DashboardData } from '../../interfaces/stats';

/**
 * Get admin dashboard data.
 *
 * @returns Users list.
 */
const getDashboardAction = async (): Promise<DashboardData> =>
  tracer.trace('ACTION.ADMIN.GET_DASHBOARD', async () => {
    const users = await Data.user.findAll();

    return { users, stats: [] };
  });

export default getDashboardAction;
