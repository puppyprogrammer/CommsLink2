'use client';

// React modules
import React from 'react';

// Node modules
import useSWR from 'swr';

// Material UI components
import {
  Box,
  Typography,
  Paper,
  Grid,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Chip,
} from '@mui/material';

// Layouts
import DashboardLayout from '@/layouts/dashboard';

// Libraries
import useSession from '@/lib/session/useSession';
import adminApi from '@/lib/api/admin';

// Models
import type { DashboardStats } from '@/models/admin';

const AdminPage = () => {
  const { session } = useSession();

  const { data: stats, mutate } = useSWR<DashboardStats>(session?.token ? 'admin-dashboard' : null, () =>
    adminApi.getDashboard(session!.token),
  );

  const handleToggleBan = async (userId: string) => {
    if (!session?.token) return;
    await adminApi.toggleBan(session.token, userId);
    mutate();
  };

  const handleTogglePremium = async (userId: string) => {
    if (!session?.token) return;
    await adminApi.togglePremium(session.token, userId);
    mutate();
  };

  if (!stats)
    return (
      <DashboardLayout>
        <Typography>Loading...</Typography>
      </DashboardLayout>
    );

  return (
    <DashboardLayout>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Admin Dashboard
      </Typography>

      <Grid container spacing={2} sx={{ mb: 4 }}>
        {[
          { label: 'Total Users', value: stats.totalUsers },
          { label: 'Total Messages', value: stats.totalMessages },
          { label: 'Total Rooms', value: stats.totalRooms },
          { label: 'Premium Users', value: stats.premiumUsers },
        ].map((stat) => (
          <Grid key={stat.label} size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'background.paper' }}>
              <Typography variant="h4" color="primary">
                {stat.value}
              </Typography>
              <Typography variant="detailText">{stat.label}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h6" sx={{ mb: 2 }}>
        Users
      </Typography>

      <Paper sx={{ bgcolor: 'background.paper', overflow: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Joined</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {stats.users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.username}</TableCell>
                <TableCell>
                  {user.is_premium && <Chip label="Premium" color="success" size="small" sx={{ mr: 0.5 }} />}
                  {user.is_banned && <Chip label="Banned" color="error" size="small" />}
                </TableCell>
                <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Button size="small" onClick={() => handleToggleBan(user.id)} sx={{ mr: 1 }}>
                    {user.is_banned ? 'Unban' : 'Ban'}
                  </Button>
                  <Button size="small" onClick={() => handleTogglePremium(user.id)}>
                    {user.is_premium ? 'Remove Premium' : 'Give Premium'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </DashboardLayout>
  );
};

export default AdminPage;
