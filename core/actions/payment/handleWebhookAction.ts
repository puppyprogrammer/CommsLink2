import tracer from '../../lib/tracer';
import Stripe from 'stripe';

import creditActions from '../credit';
import Data from '../../data';
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
        if (!pack) break;

        // Verify payment amount matches expected pack price (prevent price manipulation)
        const expectedAmountCents = Math.round(pack.priceUsd * 100);
        if (session.amount_total !== expectedAmountCents) {
          console.error(`[Stripe] Amount mismatch: expected ${expectedAmountCents}, got ${session.amount_total} for pack ${pack.id}, session ${session.id}`);
          break;
        }

        // Verify payment was actually completed
        if (session.payment_status !== 'paid') {
          console.error(`[Stripe] Payment not completed: status=${session.payment_status}, session ${session.id}`);
          break;
        }

        // ┌──────────────────────────────────────────┐
        // │ Deduplicate — skip if already processed   │
        // └──────────────────────────────────────────┘
        const existing = await Data.paymentTransaction.findByStripeSessionId(session.id);
        if (existing) {
          console.log(`Webhook duplicate: session ${session.id} already processed`);
          break;
        }

        // ┌──────────────────────────────────────────┐
        // │ Log payment transaction                   │
        // └──────────────────────────────────────────┘
        await Data.paymentTransaction.create({
          user_id: userId,
          stripe_session_id: session.id,
          stripe_payment_intent_id: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id,
          amount_usd: session.amount_total ?? Math.round(pack.priceUsd * 100),
          currency: session.currency ?? 'usd',
          status: session.payment_status ?? 'paid',
          pack_id: pack.id,
          credits_granted: pack.credits,
        });

        // ┌──────────────────────────────────────────┐
        // │ Grant credits                             │
        // └──────────────────────────────────────────┘
        await creditActions.grantTopUpCredits(userId, pack.credits, session.id);
        console.log(`User ${userId} purchased ${pack.credits} credits (session: ${session.id})`);
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.type}`);
    }

    return { success: true as const };
  });

export default handleWebhookAction;
