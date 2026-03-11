import tracer from '../../lib/tracer';
import Stripe from 'stripe';

import Data from '../../data';
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

        // Credit top-up (one-time payment)
        if (session.mode === 'payment') {
          const packId = session.metadata?.packId;
          const pack = CREDIT_PACKS.find((p) => p.id === packId);
          if (pack) {
            await creditActions.grantTopUpCredits(userId, pack.credits, session.id);
            console.log(`User ${userId} purchased ${pack.credits} credits (top-up)`);
          }
          break;
        }

        // Subscription
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await Data.user.updatePremium(userId, {
          is_premium: true,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          premium_expires_at: expiresAt,
        });

        // Grant initial monthly credits
        await creditActions.grantMonthlyCredits(userId);

        console.log(`User ${userId} subscribed`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const user = await Data.user.findByStripeCustomerId(sub.customer as string);
        if (user) {
          await Data.user.updatePremium(user.id, {
            is_premium: false,
            stripe_customer_id: sub.customer as string,
            stripe_subscription_id: null,
            premium_expires_at: null,
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const user = await Data.user.findByStripeCustomerId(sub.customer as string);
        if (user && sub.status === 'active') {
          const expiresAt = new Date(sub.current_period_end * 1000);
          await Data.user.updatePremium(user.id, {
            is_premium: true,
            stripe_customer_id: sub.customer as string,
            stripe_subscription_id: sub.id,
            premium_expires_at: expiresAt,
          });
        }
        break;
      }

      case 'invoice.paid': {
        // Grant monthly credits on each billing cycle renewal
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.billing_reason === 'subscription_cycle') {
          const user = await Data.user.findByStripeCustomerId(invoice.customer as string);
          if (user) {
            await creditActions.grantMonthlyCredits(user.id);
            console.log(`Granted monthly credits for ${user.username}`);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.warn(`Payment failed for customer ${invoice.customer}`);
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.type}`);
    }

    return { success: true as const };
  });

export default handleWebhookAction;
