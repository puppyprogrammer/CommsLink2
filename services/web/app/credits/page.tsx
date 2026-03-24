'use client';

import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, Paper, CircularProgress, Tabs, Tab, TextField, Alert } from '@mui/material';
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
type UsageLog = {
  id: string;
  service: string;
  model: string | null;
  characters: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  credits_charged: number;
  created_at: string;
};

const serviceLabel = (service: string): string => {
  const map: Record<string, string> = {
    'grok': 'AI Chat (Grok)',
    'claude': 'AI Chat (Claude)',
    'polly-tts': 'Voice (Polly)',
    'elevenlabs-tts': 'Voice (ElevenLabs)',
    'polly': 'Voice (Polly)',
    'ec2': 'Terminal',
  };
  return map[service] || service;
};

const CreditsPage = () => {
  const { session } = useSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [usage, setUsage] = useState<UsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState('');
  const [hasEmail, setHasEmail] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (!session?.token) return;
    const headers = { Authorization: `Bearer ${session.token}` };

    Promise.all([
      fetch('/api/v1/credits/status', { headers }).then((r) => r.json()),
      fetch('/api/v1/credits/packs').then((r) => r.json()),
      fetch('/api/v1/credits/transactions', { headers }).then((r) => r.json()),
      fetch('/api/v1/credits/usage', { headers }).then((r) => r.json()),
    ])
      .then(([status, packsData, txns, usageData]) => {
        setBalance(status.balance);
        setHasEmail(!!status.email);
        if (status.email) setEmail(status.email);
        setPacks(packsData.packs || []);
        setTransactions(Array.isArray(txns) ? txns : []);
        setUsage(Array.isArray(usageData) ? usageData : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session?.token]);

  const saveEmail = async () => {
    if (!session?.token || !email.trim()) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setSavingEmail(true);
    setEmailError('');
    try {
      const res = await fetch('/api/v1/profile/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setHasEmail(true);
      } else {
        setEmailError('Failed to save email');
      }
    } catch {
      setEmailError('Failed to save email');
    }
    setSavingEmail(false);
  };

  const handleBuy = async (packId: string) => {
    if (!session?.token) return;
    if (!hasEmail) return; // Shouldn't happen — button is disabled
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
        window.location.href = data.url;
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

        {/* Email prompt */}
        {!hasEmail && (
          <Paper sx={{
            p: 2, mb: 3,
            bgcolor: 'rgba(255, 180, 0, 0.06)',
            border: '1px solid rgba(255, 180, 0, 0.2)',
            borderRadius: 2,
          }}>
            <Typography sx={{ fontSize: '0.8rem', color: '#cca700', fontWeight: 600, mb: 1 }}>
              Add your email to purchase credits
            </Typography>
            <Typography sx={{ fontSize: '0.7rem', color: '#8899aa', mb: 1.5 }}>
              Required for payment receipts and account recovery.
            </Typography>
            {emailError && <Alert severity="error" sx={{ mb: 1, py: 0 }}>{emailError}</Alert>}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
              />
              <Button
                variant="contained"
                size="small"
                disabled={savingEmail || !email.trim()}
                onClick={saveEmail}
                sx={{
                  minWidth: 80,
                  background: 'linear-gradient(135deg, #cca700 0%, #aa8800 100%)',
                  color: '#0a1929',
                  fontWeight: 700,
                  '&:hover': { background: 'linear-gradient(135deg, #ddbb00 0%, #bbaa00 100%)' },
                }}
              >
                {savingEmail ? '...' : 'Save'}
              </Button>
            </Box>
          </Paper>
        )}

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
                disabled={buying === pack.id || !hasEmail}
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

        {/* Activity Tabs */}
        {(transactions.length > 0 || usage.length > 0) && (
          <>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              sx={{
                mb: 1,
                minHeight: 32,
                '& .MuiTab-root': {
                  minHeight: 32,
                  py: 0.5,
                  fontSize: '0.8rem',
                  color: '#556b82',
                  '&.Mui-selected': { color: '#4dd8d0' },
                },
                '& .MuiTabs-indicator': { backgroundColor: '#4dd8d0' },
              }}
            >
              <Tab label={`Transactions (${transactions.length})`} />
              <Tab label={`Usage (${usage.length})`} />
            </Tabs>

            <Box sx={{
              maxHeight: 350,
              overflowY: 'auto',
              borderRadius: 1,
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              {tab === 0 && transactions.slice(0, 30).map((tx) => (
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
                      {tx.description || tx.type}
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
                    {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                  </Typography>
                </Box>
              ))}

              {tab === 1 && usage.slice(0, 50).map((u) => (
                <Box
                  key={u.id}
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
                      {serviceLabel(u.service)}
                      {u.model ? ` — ${u.model}` : ''}
                    </Typography>
                    <Typography sx={{ fontSize: '0.6rem', color: '#445566' }}>
                      {new Date(u.created_at).toLocaleString()}
                      {u.characters ? ` · ${u.characters} chars` : ''}
                      {u.input_tokens ? ` · ${u.input_tokens}/${u.output_tokens} tokens` : ''}
                    </Typography>
                  </Box>
                  <Typography sx={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#f44',
                    fontFamily: 'monospace',
                  }}>
                    -{u.credits_charged}
                  </Typography>
                </Box>
              ))}

              {tab === 0 && transactions.length === 0 && (
                <Typography sx={{ p: 2, fontSize: '0.75rem', color: '#445566', textAlign: 'center' }}>
                  No transactions yet
                </Typography>
              )}
              {tab === 1 && usage.length === 0 && (
                <Typography sx={{ p: 2, fontSize: '0.75rem', color: '#445566', textAlign: 'center' }}>
                  No usage yet
                </Typography>
              )}
            </Box>
          </>
        )}
      </Box>
    </DashboardLayout>
  );
};

export default CreditsPage;
