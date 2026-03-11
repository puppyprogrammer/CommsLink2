// Libraries
import client, { authHeaders } from './client';

type CreditStatus = {
  balance: number;
};

type UsageLog = {
  id: string;
  service: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  characters: number | null;
  raw_cost_usd: number;
  credits_charged: number;
  created_at: string;
};

type CreditPack = {
  id: string;
  credits: number;
  priceUsd: number;
};

type PacksResponse = {
  packs: CreditPack[];
};

const payment = {
  buyCredits: async (bearerToken: string, packId: string) => {
    const { data } = await client.post<{ url: string }>(
      '/payment/buy-credits',
      { packId },
      { headers: authHeaders(bearerToken) },
    );
    return data;
  },

  getCreditStatus: async (bearerToken: string) => {
    const { data } = await client.get<CreditStatus>('/credits/status', {
      headers: authHeaders(bearerToken),
    });
    return data;
  },

  getUsageHistory: async (bearerToken: string) => {
    const { data } = await client.get<UsageLog[]>('/credits/usage', {
      headers: authHeaders(bearerToken),
    });
    return data;
  },

  getPacks: async () => {
    const { data } = await client.get<PacksResponse>('/credits/packs');
    return data;
  },
};

export type { CreditStatus, UsageLog, CreditPack, PacksResponse };
export default payment;
