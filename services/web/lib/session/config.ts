// Node modules
import type { IronSessionOptions } from 'iron-session';

// Models
import type { User } from '@/models/user';

export type SessionData = {
  token: string;
  user: User;
};

declare module 'iron-session' {
  interface IronSessionData {
    auth?: SessionData;
  }
}

export const sessionOptions: IronSessionOptions = {
  password: process.env.SESSION_SECRET ?? (() => { throw new Error('SESSION_SECRET env var required'); })(),
  cookieName: 'commslink_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
  },
};
