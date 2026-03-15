// Node modules
import type { NextApiRequest, NextApiResponse } from 'next';
import { withIronSessionApiRoute } from 'iron-session/next';

// Libraries
import { sessionOptions } from '@/lib/session/config';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!req.session.auth) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const { voice_id, volume, hear_own_voice } = req.body;

  // Patch the session user with updated preferences
  req.session.auth.user = {
    ...req.session.auth.user,
    ...(voice_id !== undefined && { voice_id }),
    ...(volume !== undefined && { volume }),
    ...(hear_own_voice !== undefined && { hear_own_voice }),
  };

  await req.session.save();
  res.json({ success: true });
};

export default withIronSessionApiRoute(handler, sessionOptions);
