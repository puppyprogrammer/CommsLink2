// Libraries
import client, { authHeaders } from './client';

// Models
import type { DashboardStats } from '@/models/admin';

const admin = {
  getDashboard: async (bearerToken: string) => {
    const { data } = await client.get<DashboardStats>('/admin/dashboard', {
      headers: authHeaders(bearerToken),
    });
    return data;
  },

  toggleBan: async (bearerToken: string, userId: string) => {
    const { data } = await client.post('/admin/toggle-ban', { userId }, { headers: authHeaders(bearerToken) });
    return data;
  },

  togglePremium: async (bearerToken: string, userId: string) => {
    const { data } = await client.post('/admin/toggle-premium', { userId }, { headers: authHeaders(bearerToken) });
    return data;
  },
};

export default admin;
