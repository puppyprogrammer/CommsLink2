// Node modules
import type { NextApiRequest, NextApiResponse } from 'next';
import { withIronSessionApiRoute } from 'iron-session/next';

// Libraries
import { sessionOptions } from '@/lib/session/config';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  req.session.destroy();
  res.status(200).json({ success: true });
};

export default withIronSessionApiRoute(handler, sessionOptions);
