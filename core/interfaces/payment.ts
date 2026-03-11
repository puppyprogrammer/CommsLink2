type CheckoutResult = {
  url: string;
  sessionId: string;
};

type PremiumStatus = {
  isPremium: boolean;
  expiresAt: Date | null;
};

export type { CheckoutResult, PremiumStatus };
