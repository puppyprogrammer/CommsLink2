import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password.
 *
 * @param password - Plaintext password.
 * @returns Bcrypt hash string.
 */
const hashPassword = async (password: string): Promise<string> =>
  bcrypt.hash(password, SALT_ROUNDS);

/**
 * Verify a password against a hash.
 *
 * @param password - Plaintext password.
 * @param hash     - Bcrypt hash to compare.
 * @returns True if match.
 */
const verifyPassword = async (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash);

export default { hashPassword, verifyPassword };
