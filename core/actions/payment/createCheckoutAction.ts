import tracer from '../../lib/tracer';

import stripeAdapter from '../../adapters/stripe';

import type { CheckoutResult } from '../../interfaces/payment';

type CreateCheckoutInput = {
  userId: string;
  email: string;
  username: string;
};

/**
 * Create a Stripe checkout session for the monthly subscription.
 */
const createCheckoutAction = async (input: CreateCheckoutInput): Promise<CheckoutResult> =>
  tracer.trace('ACTION.PAYMENT.CREATE_CHECKOUT', async () => {
    const session = await stripeAdapter.createCheckoutSession(
      input.userId,
      input.email,
      input.username,
    );

    return {
      url: session.url!,
      sessionId: session.id,
    };
  });

export default createCheckoutAction;
