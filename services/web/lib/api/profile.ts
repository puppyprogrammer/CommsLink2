// Libraries
import client, { authHeaders } from './client';

type UpdateProfilePayload = {
  email?: string;
  password?: string;
  voice_id?: string;
  volume?: number;
  hear_own_voice?: boolean;
};

const profile = {
  update: async (bearerToken: string, payload: UpdateProfilePayload) => {
    const { data } = await client.post('/profile/update', payload, {
      headers: authHeaders(bearerToken),
    });
    return data;
  },
};

export default profile;
