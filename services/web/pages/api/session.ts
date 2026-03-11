// Node modules
import type { NextApiRequest, NextApiResponse } from 'next';
import { withIronSessionApiRoute } from 'iron-session/next';

// Libraries
import { sessionOptions } from '@/lib/session/config';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    console.log('[SESSION] Check - has auth:', !!req.session.auth);
    console.log('[SESSION] Cookie present:', !!req.headers.cookie);
    if (req.session.auth) {
      console.log('[SESSION] User:', req.session.auth.user?.username);
      res.json({ isLoggedIn: true, auth: req.session.auth });
    } else {
      console.log('[SESSION] No auth in session');
      res.json({ isLoggedIn: false });
    }
  } catch (err) {
    console.error('[SESSION] Error:', err);
    req.session.destroy();
    res.json({ isLoggedIn: false });
  }
};

export default withIronSessionApiRoute(handler, sessionOptions);
