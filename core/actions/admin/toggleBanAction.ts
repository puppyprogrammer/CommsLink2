import tracer from '../../lib/tracer';

import Data from '../../data';

/**
 * Toggle ban status for a user (admin action).
 *
 * @param userId   - Target user UUID.
 * @param isBanned - New ban state.
 * @returns Success indicator.
 */
const toggleBanAction = async (
  userId: string,
  isBanned: boolean,
): Promise<{ success: true }> =>
  tracer.trace('ACTION.ADMIN.TOGGLE_BAN', async () => {
    await Data.user.updateBanStatus(userId, isBanned);
    return { success: true as const };
  });

export default toggleBanAction;
