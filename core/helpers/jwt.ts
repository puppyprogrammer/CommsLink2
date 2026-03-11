import jwt from 'jsonwebtoken';

type JwtPayload = {
  id: string;
  username: string;
  email: string | null;
  is_admin: boolean;
};

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return secret;
};

/**
 * Sign a JWT token.
 *
 * @param payload - User data to encode.
 * @returns Signed JWT string.
 */
const signToken = (payload: JwtPayload): string =>
  jwt.sign(payload, getSecret(), { expiresIn: '7d' });

/**
 * Verify and decode a JWT token.
 *
 * @param token - JWT string to verify.
 * @returns Decoded payload or null on failure.
 */
const verifyToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload;
  } catch {
    return null;
  }
};

export type { JwtPayload };
export default { signToken, verifyToken };
