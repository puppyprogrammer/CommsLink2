'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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

function formatDate(d: Date, range: TimeRange): string {
  if (range === '1d') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '1w') return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Line Graph Component ──
const LineGraph: React.FC<{
  grokData: { date: string; value: number }[];
  elevenData: { date: string; value: number }[];
  timeRange: TimeRange;
}> = ({ grokData, elevenData, timeRange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#0a1929';
    ctx.fillRect(0, 0, w, h);

    // Merge all dates for x-axis
    const allDates = [...new Set([...grokData.map(d => d.date), ...elevenData.map(d => d.date)])].sort();
    if (allDates.length === 0) {
      ctx.fillStyle = '#556677';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No data for this period', w / 2, h / 2);
      return;
    }

    const pad = { top: 20, right: 20, bottom: 35, left: 50 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Build lookup maps
    const grokMap = new Map(grokData.map(d => [d.date, d.value]));
    const elevenMap = new Map(elevenData.map(d => [d.date, d.value]));

    // Find max value
    const allValues = [...grokData.map(d => d.value), ...elevenData.map(d => d.value)];
    const maxVal = Math.max(...allValues, 1);

    // Grid lines
    ctx.strokeStyle = 'rgba(77, 216, 208, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      // Y-axis labels
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.fillStyle = '#556677';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toLocaleString(), pad.left - 8, y + 4);
    }

    // X-axis labels
    const labelCount = Math.min(allDates.length, 8);
    const labelStep = Math.max(1, Math.floor(allDates.length / labelCount));
    ctx.fillStyle = '#556677';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < allDates.length; i += labelStep) {
      const x = pad.left + (i / Math.max(allDates.length - 1, 1)) * plotW;
      const d = new Date(allDates[i]);
      ctx.fillText(formatDate(d, timeRange), x, h - 8);
    }

    // Draw line function
    const drawLine = (dataMap: Map<string, number>, color: string, alpha: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < allDates.length; i++) {
        const val = dataMap.get(allDates[i]) || 0;
        const x = pad.left + (i / Math.max(allDates.length - 1, 1)) * plotW;
        const y = pad.top + plotH - (val / maxVal) * plotH;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Glow
      ctx.globalAlpha = alpha * 0.15;
      ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.lineTo(pad.left, pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    drawLine(grokMap, '#4dd8d0', 0.9);
    drawLine(elevenMap, '#e0a040', 0.9);

    // Legend
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4dd8d0';
    ctx.fillRect(pad.left + 10, pad.top + 5, 12, 3);
    ctx.fillText('Grok', pad.left + 28, pad.top + 10);
    ctx.fillStyle = '#e0a040';
    ctx.fillRect(pad.left + 80, pad.top + 5, 12, 3);
    ctx.fillText('ElevenLabs', pad.left + 98, pad.top + 10);

  }, [grokData, elevenData, timeRange]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 200, borderRadius: 4 }}
    />
  );
};

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

  const filteredUsage = useMemo(() => {
    const start = getTimeRangeStart(timeRange);
    return usage.filter((log) => new Date(log.created_at) >= start);
  }, [usage, timeRange]);

  // Aggregate by day + service for line graph
  const { grokDaily, elevenDaily } = useMemo(() => {
    const grok: Record<string, number> = {};
    const eleven: Record<string, number> = {};
    for (const log of filteredUsage) {
      const day = new Date(log.created_at).toISOString().split('T')[0];
      const svc = log.service?.toLowerCase() || '';
      if (svc.includes('grok') || svc === 'chat' || svc === 'ai') {
        grok[day] = (grok[day] || 0) + log.credits_charged;
      } else if (svc.includes('eleven') || svc === 'tts' || svc === 'voice') {
        eleven[day] = (eleven[day] || 0) + log.credits_charged;
      } else {
        // Default to grok for unknown services
        grok[day] = (grok[day] || 0) + log.credits_charged;
      }
    }
    return {
      grokDaily: Object.entries(grok).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
      elevenDaily: Object.entries(eleven).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [filteredUsage]);

  const totalGrok = grokDaily.reduce((s, d) => s + d.value, 0);
  const totalEleven = elevenDaily.reduce((s, d) => s + d.value, 0);

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
          <Typography variant="body2" sx={{ color: '#6688aa', mb: 0.5 }}>Current Balance</Typography>
          <Typography variant="h4" sx={{ color: '#4dd8d0', textShadow: '0 0 10px rgba(77,216,208,0.3)' }}>
            {creditStatus?.balance?.toLocaleString() ?? 0} <span style={{ fontSize: '0.5em', color: '#6688aa' }}>credits</span>
          </Typography>
        </Paper>

        {/* Line Graph */}
        <Paper sx={{ p: 3, mb: 3, background: '#0a1929', border: '1px solid rgba(77,216,208,0.15)' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ color: '#e0e8f0' }}>Usage</Typography>
              <Typography variant="body2" sx={{ color: '#556677', fontSize: '0.75rem' }}>
                <span style={{ color: '#4dd8d0' }}>Grok: {totalGrok.toLocaleString()}</span>
                {' · '}
                <span style={{ color: '#e0a040' }}>ElevenLabs: {totalEleven.toLocaleString()}</span>
                {' · '}
                Total: {(totalGrok + totalEleven).toLocaleString()}
              </Typography>
            </Box>
            <ToggleButtonGroup value={timeRange} exclusive onChange={(_, v) => v && setTimeRange(v)} size="small">
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
          <LineGraph grokData={grokDaily} elevenData={elevenDaily} timeRange={timeRange} />
        </Paper>

        {/* Buy Credits */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, color: '#e0e8f0' }}>Buy More Credits</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {packs.map((pack) => (
              <Paper key={pack.id} sx={{
                p: 3, flex: 1, textAlign: 'center', background: '#0a1929',
                border: '1px solid rgba(77,216,208,0.15)',
                '&:hover': { borderColor: 'rgba(77,216,208,0.4)', boxShadow: '0 0 15px rgba(77,216,208,0.15)' },
              }}>
                <Typography variant="h5" sx={{ color: '#4dd8d0' }}>{pack.credits.toLocaleString()}</Typography>
                <Typography variant="body2" sx={{ color: '#6688aa', mb: 1 }}>credits</Typography>
                <Typography variant="h6" sx={{ mb: 2, color: '#e0e8f0' }}>${pack.priceUsd}</Typography>
                <Button variant="outlined" fullWidth onClick={() => handleBuyCredits(pack.id)} sx={{
                  borderColor: 'rgba(77,216,208,0.4)', color: '#4dd8d0',
                  '&:hover': { borderColor: '#4dd8d0', background: 'rgba(77,216,208,0.1)' },
                }}>Buy</Button>
              </Paper>
            ))}
          </Box>
        </Box>

        {/* Transactions */}
        {filteredUsage.length > 0 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2, color: '#e0e8f0' }}>Recent Transactions</Typography>
            <TableContainer component={Paper} sx={{ background: '#0a1929', border: '1px solid rgba(77,216,208,0.1)' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Service</TableCell>
                    <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Model</TableCell>
                    <TableCell align="right" sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Credits</TableCell>
                    <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.1)' }}>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredUsage.slice(0, 50).map((log) => {
                    const svc = log.service?.toLowerCase() || '';
                    const color = svc.includes('eleven') || svc === 'tts' ? '#e0a040' : '#4dd8d0';
                    return (
                      <TableRow key={log.id} sx={{ '&:hover': { background: 'rgba(77,216,208,0.03)' } }}>
                        <TableCell sx={{ borderColor: 'rgba(77,216,208,0.05)' }}>
                          <Chip label={log.service} size="small" sx={{
                            background: `${color}20`, color, border: `1px solid ${color}40`, fontSize: '0.7rem',
                          }} />
                        </TableCell>
                        <TableCell sx={{ color: '#8899aa', borderColor: 'rgba(77,216,208,0.05)', fontSize: '0.8rem' }}>
                          {log.model || '-'}
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#e0e8f0', borderColor: 'rgba(77,216,208,0.05)', fontFamily: 'monospace' }}>
                          {log.credits_charged}
                        </TableCell>
                        <TableCell sx={{ color: '#6688aa', borderColor: 'rgba(77,216,208,0.05)', fontSize: '0.8rem' }}>
                          {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
