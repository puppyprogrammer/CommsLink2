'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Paper, Button, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, CircularProgress, ToggleButtonGroup, ToggleButton,
} from '@mui/material';

import DashboardLayout from '@/layouts/dashboard';
import useSession from '@/lib/session/useSession';
import paymentApi from '@/lib/api/payment';
import { useToast } from '@/lib/state/ToastContext';

import type { CreditStatus, UsageLog, CreditPack } from '@/lib/api/payment';

type TimeRange = '1d' | '1w' | '1m' | '3m' | 'ytd' | '1y' | 'all';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'ALL' },
];

const SERVICE_COLORS: Record<string, string> = {
  grok: '#4dd8d0',
  elevenlabs: '#e0a040',
  claude: '#a060e0',
  search: '#40e080',
  vision: '#e06080',
  terminal: '#4090e0',
  default: '#888888',
};

function getTimeRangeStart(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case '1d': return new Date(now.getTime() - 86400000);
    case '1w': return new Date(now.getTime() - 7 * 86400000);
    case '1m': return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case '3m': return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case 'ytd': return new Date(now.getFullYear(), 0, 1);
    case '1y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case 'all': return new Date(0);
  }
}

const CreditsPage = () => {
  const { session } = useSession();
  const { toast } = useToast();
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [usage, setUsage] = useState<UsageLog[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('1m');

  useEffect(() => {
    if (!session?.token) return;
    const load = async () => {
      try {
        const [status, usageData, packsData] = await Promise.all([
          paymentApi.getCreditStatus(session.token),
          paymentApi.getUsageHistory(session.token),
          paymentApi.getPacks(),
        ]);
        setCreditStatus(status);
        setUsage(usageData);
        setPacks(packsData.packs);
      } catch {
        toast('Failed to load credit information');
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Filter usage by time range
  const filteredUsage = useMemo(() => {
    const start = getTimeRangeStart(timeRange);
    return usage.filter((log) => new Date(log.created_at) >= start);
  }, [usage, timeRange]);

  // Aggregate by service
  const serviceAggregates = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const log of filteredUsage) {
      const svc = log.service || 'other';
      agg[svc] = (agg[svc] || 0) + log.credits_charged;
    }
    return Object.entries(agg).sort((a, b) => b[1] - a[1]);
  }, [filteredUsage]);

  const totalSpent = serviceAggregates.reduce((sum, [, v]) => sum + v, 0);
  const maxBar = serviceAggregates.length > 0 ? serviceAggregates[0][1] : 1;

  const handleBuyCredits = async (packId: string) => {
    if (!session?.token) return;
    try {
      const { url } = await paymentApi.buyCredits(session.token, packId);
      window.location.href = url;
    } catch {
      toast('Failed to create checkout session');
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
          <CircularProgress />
        </Box>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Typography variant="h5" sx={{ mb: 3, color: '#4dd8d0', fontFamily: "'Orbitron', monospace" }}>
          Credits
        </Typography>

        {/* Balance */}
        <Paper sx={{ p: 3, mb: 3, background: 'linear-gradient(135deg, #0a1929 0%, #0d2137 100%)', border: '1px solid rgba(77,216,208,0.2)' }}>
          <Typography variant="body2" sx={{ color: '#6688aa', mb: 0.5 }}>
            Current Balance
          </Typography>
          <Typography variant="h4" sx={{ color: '#4dd8d0', textShadow: '0 0 10px rgba(77,216,208,0.3)' }}>
            {creditStatus?.balance?.toLocaleString() ?? 0} <span style={{ fontSize: '0.5em', color: '#6688aa' }}>credits</span>
          </Typography>
        </Paper>

        {/* Usage Graph */}
        <Paper sx={{ p: 3, mb: 3, background: '#0a1929', border: '1px solid rgba(77,216,208,0.15)' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ color: '#e0e8f0' }}>
              Usage Breakdown
            </Typography>
            <ToggleButtonGroup
              value={timeRange}
              exclusive
              onChange={(_, v) => v && setTimeRange(v)}
              size="small"
            >
              {TIME_RANGES.map((r) => (
                <ToggleButton key={r.value} value={r.value} sx={{
                  color: '#6688aa', fontSize: '0.7rem', px: 1.2, py: 0.3,
                  '&.Mui-selected': { color: '#4dd8d0', background: 'rgba(77,216,208,0.15)' },
                  borderColor: 'rgba(77,216,208,0.2)',
                }}>
                  {r.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {serviceAggregates.length === 0 ? (
            <Typography sx={{ color: '#556677', textAlign: 'center', py: 4 }}>
              No usage data for this period.
            </Typography>
          ) : (
            <>
              {/* Bar chart */}
              <Box sx={{ mb: 2 }}>
                {serviceAggregates.map(([service, credits]) => {
                  const pct = maxBar > 0 ? (credits / maxBar) * 100 : 0;
                  const color = SERVICE_COLORS[service] || SERVICE_COLORS.default;
                  return (
                    <Box key={service} sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Typography sx={{
                        width: 90, fontSize: '0.75rem', color: '#8899aa',
                        textTransform: 'capitalize', flexShrink: 0,
                      }}>
                        {service}
                      </Typography>
                      <Box sx={{ flex: 1, mx: 1, position: 'relative', height: 22 }}>
                        <Box sx={{
                          width: `${Math.max(pct, 2)}%`,
                          height: '100%',
                          background: `linear-gradient(90deg, ${color}cc, ${color}66)`,
                          borderRadius: 1,
                          transition: 'width 0.3s ease',
                          boxShadow: `0 0 8px ${color}40`,
                        }} />
                      </Box>
                      <Typography sx={{
                        width: 70, fontSize: '0.75rem', color, textAlign: 'right', flexShrink: 0,
                        fontFamily: 'monospace',
                      }}>
                        {credits.toLocaleString()}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>

              {/* Total */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1, borderTop: '1px solid rgba(77,216,208,0.1)' }}>
                <Typography sx={{ color: '#8899aa', fontSize: '0.85rem' }}>
                  Total spent ({TIME_RANGES.find((r) => r.value === timeRange)?.label})
                </Typography>
                <Typography sx={{ color: '#4dd8d0', fontFamily: 'monospace', fontWeight: 'bold' }}>
                  {totalSpent.toLocaleString()} credits
                </Typography>
              </Box>
            </>
          )}
        </Paper>

        {/* Buy More Credits */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, color: '#e0e8f0' }}>
            Buy More Credits
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {packs.map((pack) => (
              <Paper key={pack.id} sx={{
                p: 3, flex: 1, textAlign: 'center',
                background: '#0a1929', border: '1px solid rgba(77,216,208,0.15)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                '&:hover': {
                  borderColor: 'rgba(77,216,208,0.4)',
                  boxShadow: '0 0 15px rgba(77,216,208,0.15)',
                },
              }}>
                <Typography variant="h5" sx={{ color: '#4dd8d0' }}>
                  {pack.credits.toLocaleString()}
                </Typography>
                <Typography variant="body2" sx={{ color: '#6688aa', mb: 1 }}>
                  credits
                </Typography>
                <Typography variant="h6" sx={{ mb: 2, color: '#e0e8f0' }}>
                  ${pack.priceUsd}
                </Typography>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => handleBuyCredits(pack.id)}
                  sx={{
                    borderColor: 'rgba(77,216,208,0.4)',
                    color: '#4dd8d0',
                    '&:hover': {
                      borderColor: '#4dd8d0',
                      background: 'rgba(77,216,208,0.1)',
                    },
                  }}
                >
                  Buy
                </Button>
              </Paper>
            ))}
          </Box>
        </Box>

        {/* Usage History Table */}
        {filteredUsage.length > 0 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: '#e0e8f0' }}>
              Recent Transactions
            </Typography>
            <TableContainer component={Paper} sx={{ background: '#0a1929', border: '1px solid rgba(77,216,208,0.1)' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Service</TableCell>
                    <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Model</TableCell>
                    <TableCell align="right" sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Credits</TableCell>
                    <TableCell align="right" sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Cost</TableCell>
                    <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredUsage.slice(0, 50).map((log) => (
                    <TableRow key={log.id} sx={{ '&:hover': { background: 'rgba(77,216,208,0.03)' } }}>
                      <TableCell sx={{ borderColor: 'rgba(77,216,208,0.05)' }}>
                        <Chip
                          label={log.service}
                          size="small"
                          sx={{
                            background: `${SERVICE_COLORS[log.service] || SERVICE_COLORS.default}20`,
                            color: SERVICE_COLORS[log.service] || SERVICE_COLORS.default,
                            border: `1px solid ${SERVICE_COLORS[log.service] || SERVICE_COLORS.default}40`,
                            fontSize: '0.7rem',
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: '#8899aa', borderColor: 'rgba(77,216,208,0.05)', fontSize: '0.8rem' }}>
                        {log.model || '-'}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#e0e8f0', borderColor: 'rgba(77,216,208,0.05)', fontFamily: 'monospace' }}>
                        {log.credits_charged}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.05)', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        ${log.raw_cost_usd.toFixed(4)}
                      </TableCell>
                      <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.05)', fontSize: '0.8rem' }}>
                        {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Box>
    </DashboardLayout>
  );
};

export default CreditsPage;
