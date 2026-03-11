import tracer from '../../lib/tracer';
import Boom from '@hapi/boom';

import Data from '../../data';
import passwordHelper from '../../helpers/password';
import jwtHelper from '../../helpers/jwt';

import type { SanitizedUser } from '../../interfaces/user';

type LoginResult = {
  token: string;
  user: SanitizedUser;
};

/**
 * Authenticate a user and return a JWT.
 *
 * @param username - Username.
 * @param password - Plaintext password.
 * @returns JWT token and sanitized user.
 */
const loginAction = async (username: string, password: string): Promise<LoginResult> =>
  tracer.trace('ACTION.AUTH.LOGIN', async () => {
    const user = await Data.user.findByUsername(username);

    if (!user || !(await passwordHelper.verifyPassword(password, user.password_hash))) {
      throw Boom.unauthorized('Invalid credentials');
    }

    if (user.is_banned) {
      throw Boom.forbidden('Account banned');
    }

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
        is_premium: user.is_premium,
        is_admin: user.is_admin,
        voice_id: user.voice_id,
        volume: user.volume,
        use_premium_voice: user.use_premium_voice,
        hear_own_voice: user.hear_own_voice,
      },
    };
  });

export default loginAction;
