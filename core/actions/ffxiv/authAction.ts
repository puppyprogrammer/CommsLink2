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

const MONTHLY_FREE_CREDITS = 1_000;

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return secret;
};

const signFfxivToken = (id: string, username: string): string =>
  jwt.sign({ id, username, type: 'ffxiv' }, getSecret(), { expiresIn: '30d' });

/** Check and grant monthly free credits if eligible */
const checkMonthlyCredits = async (userId: string, ip: string): Promise<number> => {
  const user = await Data.user.findById(userId);
  if (!user) return 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Already received free credits this month
  if (user.last_free_credit_at && user.last_free_credit_at >= monthStart) {
    return 0;
  }

  // Check if this IP already claimed free credits this month (prevent multi-account abuse)
  const ipClaimsThisMonth = await Data.ffxivProfile.countFreeCreditsThisMonth(ip);
  if (ipClaimsThisMonth > 0) {
    return 0;
  }

  // Grant free monthly credits
  await Data.user.addCredits(userId, MONTHLY_FREE_CREDITS);
  await Data.user.update(userId, { last_free_credit_at: now });
  console.log(`[FFXIVoices] Granted ${MONTHLY_FREE_CREDITS} monthly credits to user ${userId} (IP: ${ip})`);
  return MONTHLY_FREE_CREDITS;
};

/**
 * Register a new user from the FFXIVoices plugin.
 * Creates a user row + ffxiv_profile in one flow.
 */
/** Pick default voice based on character gender */
const defaultVoiceForGender = (gender?: string): string => {
  if (gender === 'female') return 'el:m3yAHyFEFKtbCIM5n7GF'; // Ash (Donor)
  if (gender === 'male') return 'el:JBFqnCBsd6RMkjVDRZzb';   // George (Donor)
  return 'Joanna'; // Polly fallback
};

const register = async (
  username: string,
  password: string,
  contentId?: string,
  charName?: string,
  ip?: string,
  gender?: string,
): Promise<FfxivAuthResult> => {
  const existing = await Data.user.findByUsername(username);
  if (existing) {
    throw Boom.conflict('Username already taken');
  }

  const passwordHash = await passwordHelper.hashPassword(password);

  // Create user account
  const user = await Data.user.create({
    username,
    password_hash: passwordHash,
  });

  // Mark initial free credits as granted
  await Data.user.update(user.id, { last_free_credit_at: new Date() });

  // Create FFXIV profile with gender-based default voice
  const profile = await Data.ffxivProfile.create({
    user_id: user.id,
    content_id: contentId,
    char_name: charName,
    voice_id: defaultVoiceForGender(gender),
    registration_ip: ip,
  });

  const token = signFfxivToken(user.id, user.username);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      charName: profile.char_name,
      voiceId: profile.voice_id,
      credits: user.credit_balance,
    },
  };
};

/**
 * Login from the FFXIVoices plugin.
 * Uses the main user table for auth. Auto-creates ffxiv_profile if missing.
 */
const login = async (
  username: string,
  password: string,
  contentId?: string,
  charName?: string,
  ip?: string,
  gender?: string,
): Promise<FfxivAuthResult> => {
  const user = await Data.user.findByUsername(username);
  if (!user) {
    throw Boom.unauthorized('Invalid username or password');
  }

  const valid = await passwordHelper.verifyPassword(password, user.password_hash);
  if (!valid) {
    throw Boom.unauthorized('Invalid username or password');
  }

  // Get or create FFXIV profile
  let profile = await Data.ffxivProfile.findByUserId(user.id);
  if (!profile) {
    profile = await Data.ffxivProfile.create({
      user_id: user.id,
      content_id: contentId,
      char_name: charName,
      voice_id: defaultVoiceForGender(gender),
      registration_ip: ip,
    });
  } else if (contentId || charName) {
    const updateData: Partial<{ content_id: string; char_name: string }> = {};
    if (contentId) updateData.content_id = contentId;
    if (charName) updateData.char_name = charName;
    profile = await Data.ffxivProfile.update(user.id, updateData);
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
      charName: profile.char_name,
      voiceId: profile.voice_id,
      credits: user.credit_balance + bonusCredits,
    },
  };
};

export type { FfxivAuthResult };
export { register, login };
