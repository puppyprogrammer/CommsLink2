import jwt from 'jsonwebtoken';
import Boom from '@hapi/boom';

import Data from '../../data';
import passwordHelper from '../../helpers/password';

type FfxivAuthResult = {
  token: string;
  user: {
    id: string;
    email: string;
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

const signFfxivToken = (id: string, email: string): string =>
  jwt.sign({ id, email, type: 'ffxiv' }, getSecret(), { expiresIn: '30d' });

/**
 * Register a new FFXIVoices user.
 */
const register = async (
  email: string,
  password: string,
  contentId?: string,
  charName?: string,
): Promise<FfxivAuthResult> => {
  const existing = await Data.ffxivUser.findByEmail(email);
  if (existing) {
    throw Boom.conflict('Email already registered');
  }

  const passwordHash = await passwordHelper.hashPassword(password);

  const user = await Data.ffxivUser.create({
    email,
    password_hash: passwordHash,
    content_id: contentId,
    char_name: charName,
  });

  const token = signFfxivToken(user.id, user.email);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      charName: user.char_name,
      voiceId: user.voice_id,
      credits: user.credit_balance,
    },
  };
};

/**
 * Login an existing FFXIVoices user.
 */
const login = async (
  email: string,
  password: string,
  contentId?: string,
  charName?: string,
): Promise<FfxivAuthResult> => {
  const user = await Data.ffxivUser.findByEmail(email);
  if (!user) {
    throw Boom.unauthorized('Invalid email or password');
  }

  const valid = await passwordHelper.verifyPassword(password, user.password_hash);
  if (!valid) {
    throw Boom.unauthorized('Invalid email or password');
  }

  // Optionally update contentId / charName on login
  if (contentId || charName) {
    const updateData: Partial<{ content_id: string; char_name: string }> = {};
    if (contentId) updateData.content_id = contentId;
    if (charName) updateData.char_name = charName;
    await Data.ffxivUser.update(user.id, updateData);
  }

  const token = signFfxivToken(user.id, user.email);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      charName: charName || user.char_name,
      voiceId: user.voice_id,
      credits: user.credit_balance,
    },
  };
};

export type { FfxivAuthResult };
export { register, login };
