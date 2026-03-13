import { describe, it, expect, vi, beforeEach } from 'vitest';
import creditActions from './index';
import Data from '../../data';

vi.mock('../../data', () => ({
  default: {
    user: {
      findById: vi.fn(),
      deductCredits: vi.fn(),
      addCredits: vi.fn(),
    },
    creditTransaction: { create: vi.fn() },
    creditUsageLog: { create: vi.fn() },
  },
}));

const mockUser = (balance: number) => ({
  id: 'user-1',
  username: 'puppy',
  credit_balance: balance,
});

describe('creditActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasCredits', () => {
    it('returns true when user has enough credits', async () => {
      vi.mocked(Data.user.findById).mockResolvedValue(mockUser(100) as never);
      expect(await creditActions.hasCredits('user-1', 50)).toBe(true);
    });

    it('returns false when user has insufficient credits', async () => {
      vi.mocked(Data.user.findById).mockResolvedValue(mockUser(5) as never);
      expect(await creditActions.hasCredits('user-1', 50)).toBe(false);
    });

    it('returns false for nonexistent user', async () => {
      vi.mocked(Data.user.findById).mockResolvedValue(null);
      expect(await creditActions.hasCredits('nobody')).toBe(false);
    });
  });

  describe('grantTopUpCredits', () => {
    it('adds credits and creates transaction log', async () => {
      vi.mocked(Data.user.addCredits).mockResolvedValue(mockUser(600) as never);

      const result = await creditActions.grantTopUpCredits('user-1', 500, 'stripe-ref');

      expect(Data.user.addCredits).toHaveBeenCalledWith('user-1', 500);
      expect(Data.creditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          amount: 500,
          type: 'topup',
          reference_id: 'stripe-ref',
        }),
      );
      expect(result.newBalance).toBe(600);
    });
  });

  describe('chargeEC2Usage', () => {
    it('does not charge user with zero balance', async () => {
      vi.mocked(Data.user.findById).mockResolvedValue(mockUser(0) as never);

      const result = await creditActions.chargeEC2Usage('user-1', 3600);

      expect(Data.user.deductCredits).not.toHaveBeenCalled();
      expect(result.credits).toBe(0);
    });

    it('caps charge at remaining balance', async () => {
      vi.mocked(Data.user.findById).mockResolvedValue(mockUser(2) as never);
      vi.mocked(Data.user.deductCredits).mockResolvedValue(mockUser(0) as never);

      const result = await creditActions.chargeEC2Usage('user-1', 86400);

      const chargedAmount = vi.mocked(Data.user.deductCredits).mock.calls[0][1];
      expect(chargedAmount).toBeLessThanOrEqual(2);
      expect(result.newBalance).toBe(0);
    });
  });
});
