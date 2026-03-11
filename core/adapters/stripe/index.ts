import Stripe from 'stripe';

const getStripe = (): Stripe => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is required');
  return new Stripe(key);
};

/**
 * Create a Stripe checkout session for a one-time credit top-up.
 */
const createTopUpCheckout = async (
  userId: string,
  email: string,
  username: string,
  packId: string,
  priceUsd: number,
  credits: number,
): Promise<Stripe.Checkout.Session> => {
  const stripe = getStripe();
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

  return stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${credits} CommsLink Credits` },
          unit_amount: Math.round(priceUsd * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${clientUrl}/credits?purchased=true`,
    cancel_url: `${clientUrl}/credits`,
    customer_email: email,
    client_reference_id: userId,
    metadata: { userId, username, packId },
  });
};

/**
 * Verify and construct a webhook event.
 */
const constructWebhookEvent = (body: Buffer, signature: string): Stripe.Event => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');

  return stripe.webhooks.constructEvent(body, signature, secret);
};

export default {
  createTopUpCheckout,
  constructWebhookEvent,
};
