import jwt from 'jsonwebtoken';
import Boom from '@hapi/boom';

import Data from '../../data';
import passwordHelper from '../../helpers/password';

type FfxivAuthResult = {
  token: string;
  user: {
    id: string;
    username: string;
    charName: string | null;
    voiceId: string;
    credits: number;
  };
};

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return secret;
};

const signFfxivToken = (id: string, username: string): string =>
  jwt.sign({ id, username, type: 'ffxiv' }, getSecret(), { expiresIn: '30d' });

/** Check and grant monthly free credits if eligible */
const checkMonthlyCredits = async (userId: string, ip: string): Promise<number> => {
  const user = await Data.ffxivUser.findById(userId);
  if (!user) return 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Already received free credits this month
  if (user.last_free_credit_at && user.last_free_credit_at >= monthStart) {
    return 0;
  }

  // Check if this IP already claimed free credits this month (prevent multi-account abuse)
  const ipClaimsThisMonth = await Data.ffxivUser.countFreeCreditsThisMonth(ip);
  if (ipClaimsThisMonth > 0) {
    return 0;
  }

  // Grant 10,000 free monthly credits
  const MONTHLY_FREE_CREDITS = 10_000;
  await Data.ffxivUser.addCredits(userId, MONTHLY_FREE_CREDITS);
  await Data.ffxivUser.update(userId, { last_free_credit_at: now });
  console.log(`[FFXIVoices] Granted ${MONTHLY_FREE_CREDITS} monthly credits to user ${userId} (IP: ${ip})`);
  return MONTHLY_FREE_CREDITS;
};

const register = async (
  username: string,
  password: string,
  contentId?: string,
  charName?: string,
  ip?: string,
): Promise<FfxivAuthResult> => {
  const existing = await Data.ffxivUser.findByUsername(username);
  if (existing) {
    throw Boom.conflict('Username already taken');
  }

  const passwordHash = await passwordHelper.hashPassword(password);

  const user = await Data.ffxivUser.create({
    username,
    password_hash: passwordHash,
    content_id: contentId,
    char_name: charName,
    registration_ip: ip,
  });

  // Mark free credits as granted for this month
  await Data.ffxivUser.update(user.id, { last_free_credit_at: new Date() });

  const token = signFfxivToken(user.id, user.username);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      charName: user.char_name,
      voiceId: user.voice_id,
      credits: user.credit_balance,
    },
  };
};

const login = async (
  username: string,
  password: string,
  contentId?: string,
  charName?: string,
  ip?: string,
): Promise<FfxivAuthResult> => {
  const user = await Data.ffxivUser.findByUsername(username);
  if (!user) {
    throw Boom.unauthorized('Invalid username or password');
  }

  const valid = await passwordHelper.verifyPassword(password, user.password_hash);
  if (!valid) {
    throw Boom.unauthorized('Invalid username or password');
  }

  if (contentId || charName) {
    const updateData: Partial<{ content_id: string; char_name: string }> = {};
    if (contentId) updateData.content_id = contentId;
    if (charName) updateData.char_name = charName;
    await Data.ffxivUser.update(user.id, updateData);
  }

  // Check and grant monthly free credits
  let bonusCredits = 0;
  if (ip) {
    bonusCredits = await checkMonthlyCredits(user.id, ip);
  }

  const token = signFfxivToken(user.id, user.username);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      charName: charName || user.char_name,
      voiceId: user.voice_id,
      credits: user.credit_balance + bonusCredits,
    },
  };
};

export type { FfxivAuthResult };
export { register, login };
