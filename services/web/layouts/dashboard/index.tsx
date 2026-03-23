'use client';

// React modules
import React, { useEffect, useState } from 'react';

// Node modules
import { useRouter, usePathname } from 'next/navigation';

// Material UI components
import { Box, AppBar, Toolbar, Typography, IconButton, Tooltip } from '@mui/material';

// Material UI icons
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LogoutIcon from '@mui/icons-material/Logout';

// Libraries
import useSession from '@/lib/session/useSession';

// Components
import ConnectionStatus from '@/components/ConnectionStatus';

// Styles
import classes from './Dashboard.module.scss';

const ACTIVITY_BAR_WIDTH = 48;

type DashboardLayoutProps = {
  children: React.ReactNode;
  activityBarExtra?: React.ReactNode;
  onChatClick?: () => void;
};


const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, activityBarExtra, onChatClick }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { session, isLoggedIn, isLoading } = useSession();
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/login');
    }
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!session?.token) return;
    fetch('/api/v1/credits/status', {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.balance != null) setCreditBalance(data.balance); })
      .catch(() => {});
  }, [session?.token]);

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
  };

  if (isLoading || !isLoggedIn) {
    return null;
  }

  return (
    <Box className={classes.root}>
      <AppBar position="fixed" className={classes.appBar}>
        <Toolbar variant="dense" sx={{ minHeight: 36, px: 1 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={20} height={20} style={{
            marginRight: '0.5rem',
            filter: 'drop-shadow(0 0 6px rgba(77, 216, 208, 0.5))',
          }} />
          <Typography variant="body2" sx={{
            fontFamily: "'Orbitron', monospace", fontWeight: 400, color: '#4dd8d0',
            textShadow: '0 0 8px rgba(77, 216, 208, 0.4)',
            display: { xs: 'none', sm: 'block' },
          }}>
            CommsLink
          </Typography>
          <Box sx={{ flex: 1 }} />
          <ConnectionStatus />
          {creditBalance !== null && (
            <Typography
              variant="detailText"
              onClick={() => router.push('/credits')}
              sx={{
                fontSize: '0.65rem',
                color: creditBalance > 1000 ? '#4dd8d0' : creditBalance > 100 ? '#cca700' : '#f44',
                mr: 1,
                opacity: 0.8,
                cursor: 'pointer',
                '&:hover': { opacity: 1 },
              }}
              title="Credits — click to buy more"
            >
              {creditBalance.toLocaleString()}c
            </Typography>
          )}
          <Typography
            variant="detailText"
            onClick={() => router.push('/profile')}
            sx={{
              mr: 1,
              fontSize: '0.75rem',
              cursor: 'pointer',
              color: '#858585',
              '&:hover': { color: '#4dd8d0' },
              display: { xs: 'none', sm: 'block' },
            }}
            title="Profile"
          >
            {session?.user.username}
          </Typography>
          <IconButton size="small" onClick={handleLogout} title="Logout" sx={{ color: '#858585' }}>
            <LogoutIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Activity bar — room icons + admin */}
      <Box className={classes.activityBar}>
        {activityBarExtra && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              overflowY: 'auto',
              overflowX: 'hidden',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
              pb: 0.5,
              pt: 0.25,
              flex: 1,
            }}
          >
            {activityBarExtra}
          </Box>
        )}
        {session?.user.is_admin && (
          <Tooltip title="Admin" placement="right">
            <IconButton
              onClick={() => router.push('/admin')}
              sx={{
                color: pathname === '/admin' ? '#ffffff' : '#858585',
                borderLeft: pathname === '/admin' ? '2px solid #007acc' : '2px solid transparent',
                borderRadius: 0,
                width: ACTIVITY_BAR_WIDTH,
                height: ACTIVITY_BAR_WIDTH,
                '&:hover': { color: '#cccccc' },
              }}
            >
              <AdminPanelSettingsIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box component="main" className={classes.content}>
        {children}
      </Box>
    </Box>
  );
};

export default DashboardLayout;
