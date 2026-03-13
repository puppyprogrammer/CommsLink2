import { describe, it, expect } from 'vitest';
import passwordHelper from './password';

describe('password helper', () => {
  it('hashes and verifies a password', async () => {
    const hash = await passwordHelper.hashPassword('mypassword');
    expect(hash).not.toBe('mypassword');
    expect(await passwordHelper.verifyPassword('mypassword', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await passwordHelper.hashPassword('correct');
    expect(await passwordHelper.verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for same input (salted)', async () => {
    const hash1 = await passwordHelper.hashPassword('same');
    const hash2 = await passwordHelper.hashPassword('same');
    expect(hash1).not.toBe(hash2);
  });
});
