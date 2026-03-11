import tracer from '../../lib/tracer';

import Data from '../../data';

/**
 * Toggle premium status for a user (admin action).
 *
 * @param userId    - Target user UUID.
 * @param isPremium - New premium state.
 * @returns Success indicator.
 */
const togglePremiumAction = async (
  userId: string,
  isPremium: boolean,
): Promise<{ success: true }> =>
  tracer.trace('ACTION.ADMIN.TOGGLE_PREMIUM', async () => {
    const expiresAt = isPremium
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      : null;

    await Data.user.updatePremium(userId, {
      is_premium: isPremium,
      stripe_customer_id: isPremium ? 'cus_manual_admin' : null,
      stripe_subscription_id: null,
      premium_expires_at: expiresAt,
    });

    return { success: true as const };
  });

export default togglePremiumAction;
