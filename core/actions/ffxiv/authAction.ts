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

const register = async (
  username: string,
  password: string,
  contentId?: string,
  charName?: string,
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
  });

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

  const token = signFfxivToken(user.id, user.username);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      charName: charName || user.char_name,
      voiceId: user.voice_id,
      credits: user.credit_balance,
    },
  };
};

export type { FfxivAuthResult };
export { register, login };
