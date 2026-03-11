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
    console.log('[LOGIN] Incoming login request for:', req.body?.username);
    console.log('[LOGIN] Existing session auth:', !!req.session.auth);
    console.log('[LOGIN] Cookies:', req.headers.cookie?.substring(0, 100));

    // Destroy any stale/corrupt session before logging in
    req.session.destroy();
    console.log('[LOGIN] Session destroyed');

    const { username, password } = req.body;
    const result = await authApi.login({ username, password });
    console.log('[LOGIN] Backend auth success for:', result.user?.username);

    req.session.auth = {
      token: result.token,
      user: result.user as never,
    };
    await req.session.save();
    console.log('[LOGIN] Session saved successfully');

    const setCookie = res.getHeader('set-cookie');
    console.log('[LOGIN] Set-Cookie header present:', !!setCookie);

    res.status(200).json({ success: true, user: result.user });
    console.log('[LOGIN] Response sent 200');
  } catch (error) {
    console.error('[LOGIN] Error:', error);
    const message = error instanceof Error ? error.message : 'Invalid credentials';
    res.status(401).json({ message });
  }
};

export default withIronSessionApiRoute(handler, sessionOptions);
