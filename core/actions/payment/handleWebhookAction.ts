import tracer from '../../lib/tracer';
import Stripe from 'stripe';

import creditActions from '../credit';
import { CREDIT_PACKS } from '../../constants/creditRates';

/**
 * Process a Stripe webhook event.
 *
 * @param event - Verified Stripe event.
 * @returns Success indicator.
 */
const handleWebhookAction = async (event: Stripe.Event): Promise<{ success: true }> =>
  tracer.trace('ACTION.PAYMENT.HANDLE_WEBHOOK', async () => {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id || session.metadata?.userId;
        if (!userId) break;

        const packId = session.metadata?.packId;
        const pack = CREDIT_PACKS.find((p) => p.id === packId);
        if (pack) {
          await creditActions.grantTopUpCredits(userId, pack.credits, session.id);
          console.log(`User ${userId} purchased ${pack.credits} credits`);
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.type}`);
    }

    return { success: true as const };
  });

export default handleWebhookAction;
