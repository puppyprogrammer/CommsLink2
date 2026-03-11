'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
} from '@mui/material';

import DashboardLayout from '@/layouts/dashboard';
import useSession from '@/lib/session/useSession';
import paymentApi from '@/lib/api/payment';
import { useToast } from '@/lib/state/ToastContext';

import type { CreditStatus, UsageLog, CreditPack } from '@/lib/api/payment';

const CreditsPage = () => {
  const { session } = useSession();
  const { toast } = useToast();
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [usage, setUsage] = useState<UsageLog[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);

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
        <Typography variant="h5" color="primary" sx={{ mb: 3 }}>
          Credits
        </Typography>

        {/* Balance */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="detailText" sx={{ mb: 0.5 }}>
            Current Balance
          </Typography>
          <Typography variant="h4" color="primary">
            {creditStatus?.balance?.toLocaleString() ?? 0} credits
          </Typography>
        </Paper>

        {/* Buy More Credits */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Buy More Credits
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {packs.map((pack) => (
              <Paper key={pack.id} sx={{ p: 3, flex: 1, textAlign: 'center' }}>
                <Typography variant="h5" color="primary">
                  {pack.credits}
                </Typography>
                <Typography variant="detailText" display="block" sx={{ mb: 1 }}>
                  credits
                </Typography>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  ${pack.priceUsd}
                </Typography>
                <Button variant="outlined" fullWidth onClick={() => handleBuyCredits(pack.id)}>
                  Buy
                </Button>
              </Paper>
            ))}
          </Box>
        </Box>

        {/* Usage History */}
        {usage.length > 0 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Recent Usage
            </Typography>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Service</TableCell>
                    <TableCell>Model</TableCell>
                    <TableCell align="right">Credits</TableCell>
                    <TableCell align="right">Cost (USD)</TableCell>
                    <TableCell>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {usage.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Chip label={log.service} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>{log.model || '-'}</TableCell>
                      <TableCell align="right">{log.credits_charged}</TableCell>
                      <TableCell align="right">${log.raw_cost_usd.toFixed(4)}</TableCell>
                      <TableCell>{new Date(log.created_at).toLocaleDateString()}</TableCell>
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
