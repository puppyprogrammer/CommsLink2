'use client';

// React modules
import React, { useEffect, useState } from 'react';

// Node modules
import { useRouter, usePathname } from 'next/navigation';

// Material UI components
import { Box, AppBar, Toolbar, Typography, IconButton, Chip, Tooltip } from '@mui/material';

// Material UI icons
import ChatIcon from '@mui/icons-material/Chat';
import ForumIcon from '@mui/icons-material/Forum';
import PersonIcon from '@mui/icons-material/Person';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LogoutIcon from '@mui/icons-material/Logout';

// Libraries
import useSession from '@/lib/session/useSession';
import paymentApi from '@/lib/api/payment';

// Components
import ConnectionStatus from '@/components/ConnectionStatus';
import SpendingBar from '@/components/SpendingBar';

// Styles
import classes from './Dashboard.module.scss';

const ACTIVITY_BAR_WIDTH = 48;

type DashboardLayoutProps = {
  children: React.ReactNode;
  activityBarExtra?: React.ReactNode;
  onChatClick?: () => void;
};

const navItems = [
  { label: 'Chat', href: '/chat', icon: <ChatIcon /> },
  { label: 'Forum', href: '/forum', icon: <ForumIcon /> },
];

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
    paymentApi
      .getCreditStatus(session.token)
      .then((status) => setCreditBalance(status.balance))
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
          <img src="/logo.svg" alt="" width={20} height={20} style={{ marginRight: '0.5rem' }} />
          <Typography variant="body2" sx={{ fontFamily: "'Orbitron', monospace", fontWeight: 400, color: '#A020F0' }}>
            CommsLink
          </Typography>
          <SpendingBar />
          <ConnectionStatus />
          {creditBalance !== null && (
            <Chip
              label={`${creditBalance.toLocaleString()} credits`}
              size="small"
              variant="outlined"
              onClick={() => router.push('/credits')}
              sx={{ mr: 1.5, cursor: 'pointer', height: 22, fontSize: '0.75rem' }}
            />
          )}
          <Typography variant="detailText" sx={{ mr: 1, fontSize: '0.75rem' }}>
            {session?.user.username}
          </Typography>
          <IconButton
            size="small"
            onClick={() => router.push('/profile')}
            title="Profile"
            sx={{ mr: 0.5, color: '#858585' }}
          >
            <PersonIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton size="small" onClick={handleLogout} title="Logout" sx={{ color: '#858585' }}>
            <LogoutIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* VS Code-style activity bar — icons only */}
      <Box className={classes.activityBar}>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Tooltip key={item.href} title={item.label} placement="right">
              <IconButton
                onClick={() => {
                  if (item.href === '/chat' && pathname === '/chat' && onChatClick) {
                    onChatClick();
                  } else {
                    router.push(item.href);
                  }
                }}
                sx={{
                  color: isActive ? '#ffffff' : '#858585',
                  borderLeft: isActive ? '2px solid #007acc' : '2px solid transparent',
                  borderRadius: 0,
                  width: ACTIVITY_BAR_WIDTH,
                  height: ACTIVITY_BAR_WIDTH,
                  '&:hover': { color: '#cccccc' },
                }}
              >
                {item.icon}
              </IconButton>
            </Tooltip>
          );
        })}
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
        {activityBarExtra && (
          <>
            <Box sx={{ width: 28, borderTop: '1px solid', borderColor: 'divider', my: 0.5 }} />
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                overflowY: 'auto',
                overflowX: 'hidden',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
                pb: 0.5,
              }}
            >
              {activityBarExtra}
            </Box>
          </>
        )}
      </Box>

      <Box component="main" className={classes.content}>
        {children}
      </Box>
    </Box>
  );
};

export default DashboardLayout;
