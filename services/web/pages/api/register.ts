// Node modules
import type { NextApiRequest, NextApiResponse } from 'next';
import { withIronSessionApiRoute } from 'iron-session/next';

// Libraries
import { sessionOptions } from '@/lib/session/config';
import authApi from '@/lib/api/auth';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body;
    const result = await authApi.register({ username, password });

    req.session.auth = {
      token: result.token,
      user: result.user as never,
    };
    await req.session.save();

    res.status(200).json({ success: true, user: result.user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    res.status(400).json({ message });
  }
};

export default withIronSessionApiRoute(handler, sessionOptions);
