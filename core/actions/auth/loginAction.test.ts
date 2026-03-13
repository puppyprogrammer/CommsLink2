import { describe, it, expect, vi, beforeEach } from 'vitest';
import loginAction from './loginAction';
import Data from '../../data';
import passwordHelper from '../../helpers/password';
import jwtHelper from '../../helpers/jwt';

vi.mock('../../data', () => ({
  default: {
    user: {
      findByUsername: vi.fn(),
    },
  },
}));

vi.mock('../../helpers/password', () => ({
  default: {
    verifyPassword: vi.fn(),
  },
}));

vi.mock('../../helpers/jwt', () => ({
  default: {
    signToken: vi.fn(),
  },
}));

const mockUser = {
  id: 'user-1',
  username: 'puppy',
  email: 'puppy@example.com',
  password_hash: '$2b$10$hashed',
  is_banned: false,
  is_premium: true,
  is_admin: true,
  voice_id: null,
  volume: 1.0,
  use_premium_voice: false,
  hear_own_voice: false,
};

describe('loginAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns token and sanitized user on valid login', async () => {
    vi.mocked(Data.user.findByUsername).mockResolvedValue(mockUser as never);
    vi.mocked(passwordHelper.verifyPassword).mockResolvedValue(true);
    vi.mocked(jwtHelper.signToken).mockReturnValue('jwt-token-123');

    const result = await loginAction('puppy', 'correctpassword');

    expect(Data.user.findByUsername).toHaveBeenCalledWith('puppy');
    expect(passwordHelper.verifyPassword).toHaveBeenCalledWith('correctpassword', '$2b$10$hashed');
    expect(result.token).toBe('jwt-token-123');
    expect(result.user.username).toBe('puppy');
    expect(result.user).not.toHaveProperty('password_hash');
  });

  it('throws unauthorized on wrong password', async () => {
    vi.mocked(Data.user.findByUsername).mockResolvedValue(mockUser as never);
    vi.mocked(passwordHelper.verifyPassword).mockResolvedValue(false);

    await expect(loginAction('puppy', 'wrongpass')).rejects.toThrow('Invalid credentials');
  });

  it('throws unauthorized on nonexistent user', async () => {
    vi.mocked(Data.user.findByUsername).mockResolvedValue(null);

    await expect(loginAction('nobody', 'pass')).rejects.toThrow('Invalid credentials');
  });

  it('throws forbidden on banned user', async () => {
    vi.mocked(Data.user.findByUsername).mockResolvedValue({ ...mockUser, is_banned: true } as never);
    vi.mocked(passwordHelper.verifyPassword).mockResolvedValue(true);

    await expect(loginAction('puppy', 'correctpassword')).rejects.toThrow('Account banned');
  });
});
