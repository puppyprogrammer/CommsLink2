import Boom from '@hapi/boom';

import Data from '../../data';
import jwtHelper from '../../helpers/jwt';

import type { Server, Request } from '@hapi/hapi';

type AuthCredentials = {
  id: string;
  username: string;
  email: string | null;
  is_admin: boolean;
};

/**
 * Register JWT bearer token auth strategy.
 *
 * @param server - Hapi server instance.
 */
const registerAuthStrategy = async (server: Server): Promise<void> => {
  await server.register(require('hapi-auth-bearer-token'));

  server.auth.strategy('jwt', 'bearer-access-token', {
    validate: async (request: Request, token: string) => {
      const decoded = jwtHelper.verifyToken(token);

      if (!decoded) {
        return { isValid: false, credentials: {} as AuthCredentials };
      }

      const user = await Data.user.findById(decoded.id);

      if (!user) {
        return { isValid: false, credentials: {} as AuthCredentials };
      }

      if (user.is_banned) {
        throw Boom.forbidden('Account banned');
      }

      const credentials: AuthCredentials = {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
      };

      return { isValid: true, credentials };
    },
  });
};

export type { AuthCredentials };
export default registerAuthStrategy;
