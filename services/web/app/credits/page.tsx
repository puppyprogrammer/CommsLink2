'use client';

import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, Paper, CircularProgress } from '@mui/material';
import DashboardLayout from '@/layouts/dashboard';
import useSession from '@/lib/session/useSession';

type CreditPack = { id: string; credits: number; priceUsd: number };
type Transaction = {
  id: string;
  amount: number;
  balance_after: number;
  type: string;
  description: string;
  created_at: string;
};

const CreditsPage = () => {
  const { session } = useSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.token) return;
    const headers = { Authorization: `Bearer ${session.token}` };

    Promise.all([
      fetch('/api/v1/credits/status', { headers }).then((r) => r.json()),
      fetch('/api/v1/credits/packs').then((r) => r.json()),
      fetch('/api/v1/credits/transactions', { headers }).then((r) => r.json()),
    ])
      .then(([status, packsData, txns]) => {
        setBalance(status.balance);
        setPacks(packsData.packs || []);
        setTransactions(Array.isArray(txns) ? txns : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session?.token]);

  const handleBuy = async (packId: string) => {
    if (!session?.token) return;
    setBuying(packId);
    try {
      const res = await fetch('/api/v1/payment/buy-credits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // Redirect to Stripe checkout
      }
    } catch (err) {
      console.error('Purchase failed:', err);
    }
    setBuying(null);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
          <CircularProgress sx={{ color: '#4dd8d0' }} />
        </Box>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 600, mx: 'auto' }}>
        {/* Balance */}
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography sx={{ fontSize: '0.8rem', color: '#556b82', mb: 0.5 }}>
            Your Balance
          </Typography>
          <Typography sx={{
            fontSize: '2.5rem',
            fontWeight: 700,
            fontFamily: "'Orbitron', monospace",
            color: balance && balance > 1000 ? '#4dd8d0' : balance && balance > 100 ? '#cca700' : '#f44',
            textShadow: '0 0 20px rgba(77, 216, 208, 0.3)',
          }}>
            {balance?.toLocaleString() ?? 0}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: '#556b82' }}>
            credits
          </Typography>
        </Box>

        {/* Credit Packs */}
        <Typography sx={{
          fontSize: '0.85rem',
          color: '#4dd8d0',
          fontWeight: 600,
          mb: 1.5,
          letterSpacing: 0.5,
        }}>
          Buy Credits
        </Typography>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: 1.5,
          mb: 3,
        }}>
          {packs.map((pack) => (
            <Paper
              key={pack.id}
              sx={{
                p: 2,
                textAlign: 'center',
                bgcolor: 'rgba(77, 216, 208, 0.04)',
                border: '1px solid rgba(77, 216, 208, 0.12)',
                borderRadius: 2,
                transition: 'all 0.15s',
                '&:hover': {
                  borderColor: 'rgba(77, 216, 208, 0.3)',
                  bgcolor: 'rgba(77, 216, 208, 0.08)',
                  transform: 'translateY(-2px)',
                },
              }}
            >
              <Typography sx={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: '#4dd8d0',
                fontFamily: "'Orbitron', monospace",
              }}>
                {pack.credits.toLocaleString()}
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', color: '#556b82', mb: 1.5 }}>
                credits
              </Typography>
              <Button
                variant="contained"
                size="small"
                fullWidth
                disabled={buying === pack.id}
                onClick={() => handleBuy(pack.id)}
                sx={{
                  py: 0.75,
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  background: 'linear-gradient(135deg, #4dd8d0 0%, #3ab8b0 100%)',
                  color: '#0a1929',
                  '&:hover': { background: 'linear-gradient(135deg, #5de8e0 0%, #4ac8c0 100%)' },
                }}
              >
                {buying === pack.id ? 'Redirecting...' : `$${pack.priceUsd.toFixed(2)}`}
              </Button>
            </Paper>
          ))}
        </Box>

        {/* Recent Transactions */}
        {transactions.length > 0 && (
          <>
            <Typography sx={{
              fontSize: '0.85rem',
              color: '#4dd8d0',
              fontWeight: 600,
              mb: 1,
              letterSpacing: 0.5,
            }}>
              Recent Activity
            </Typography>
            <Box sx={{
              maxHeight: 300,
              overflowY: 'auto',
              borderRadius: 1,
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              {transactions.slice(0, 20).map((tx) => (
                <Box
                  key={tx.id}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 1.5,
                    py: 0.75,
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <Box>
                    <Typography sx={{ fontSize: '0.75rem', color: '#8ba4bd' }}>
                      {tx.description}
                    </Typography>
                    <Typography sx={{ fontSize: '0.6rem', color: '#445566' }}>
                      {new Date(tx.created_at).toLocaleString()}
                    </Typography>
                  </Box>
                  <Typography sx={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: tx.amount > 0 ? '#4dd8d0' : '#f44',
                    fontFamily: 'monospace',
                  }}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        )}
      </Box>
    </DashboardLayout>
  );
};

export default CreditsPage;
