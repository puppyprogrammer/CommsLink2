// Libraries
import client from './client';

type LoginPayload = {
  username: string;
  password: string;
};

type RegisterPayload = {
  username: string;
  password: string;
};

type AuthResponse = {
  token: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    is_admin: boolean;
    is_premium: boolean;
  };
};

const auth = {
  login: async (payload: LoginPayload) => {
    const { data } = await client.post<AuthResponse>('/auth/login', payload);
    return data;
  },

  register: async (payload: RegisterPayload) => {
    const { data } = await client.post<AuthResponse>('/auth/register', payload);
    return data;
  },
};

export default auth;
