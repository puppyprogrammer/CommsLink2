import { describe, it, expect, beforeAll } from 'vitest';
import jwtHelper from './jwt';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-for-vitest';
});

describe('jwt helper', () => {
  const payload = {
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    is_admin: false,
  };

  it('signs and verifies a token', () => {
    const token = jwtHelper.signToken(payload);
    const decoded = jwtHelper.verifyToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(payload.id);
    expect(decoded!.username).toBe(payload.username);
    expect(decoded!.email).toBe(payload.email);
    expect(decoded!.is_admin).toBe(false);
  });

  it('returns null for an invalid token', () => {
    const decoded = jwtHelper.verifyToken('garbage.token.here');
    expect(decoded).toBeNull();
  });

  it('returns null for a token signed with wrong secret', () => {
    const token = jwtHelper.signToken(payload);
    process.env.JWT_SECRET = 'different-secret';
    const decoded = jwtHelper.verifyToken(token);
    expect(decoded).toBeNull();
    process.env.JWT_SECRET = 'test-secret-key-for-vitest';
  });
});
