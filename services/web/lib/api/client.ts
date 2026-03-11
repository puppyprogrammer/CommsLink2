// Node modules
import axios from 'axios';

// Libraries
import config from '@/settings/config.json';

const apiHost = (typeof window === 'undefined' && process.env.INTERNAL_API_URL) || config.API_HOSTNAME;

const client = axios.create({
  baseURL: `${apiHost}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
});

const authHeaders = (bearerToken: string) => ({
  Authorization: `Bearer ${bearerToken}`,
});

const handle = async <T>(promise: Promise<{ data: T }>) => {
  const response = await promise;
  return response.data;
};

export { client, authHeaders, handle };
export default client;
