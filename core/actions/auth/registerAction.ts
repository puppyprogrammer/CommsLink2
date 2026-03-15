import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';
import passwordHelper from '../../helpers/password';
import jwtHelper from '../../helpers/jwt';

import type { SanitizedUser } from '../../interfaces/user';

type RegisterResult = {
  token: string;
  user: SanitizedUser;
};

/**
 * Register a new user account.
 *
 * @param username - Desired username.
 * @param password - Plaintext password.
 * @returns JWT token and sanitized user.
 */
const registerAction = async (username: string, password: string): Promise<RegisterResult> =>
  tracer.trace('ACTION.AUTH.REGISTER', async () => {
    const existing = await Data.user.findByUsername(username);
    if (existing) {
      throw Boom.conflict('Username already exists');
    }

    const password_hash = await passwordHelper.hashPassword(password);
    const user = await Data.user.create({ username, password_hash });

    const token = jwtHelper.signToken({
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        voice_id: user.voice_id,
        volume: user.volume,
        hear_own_voice: user.hear_own_voice,
      },
    };
  });

export default registerAction;
