'use client';

// React modules
import React, { useEffect } from 'react';

// Node modules
import { useRouter, usePathname } from 'next/navigation';

// Material UI components
import { Box, AppBar, Toolbar, Typography, IconButton, Tooltip } from '@mui/material';

// Material UI icons
import ChatIcon from '@mui/icons-material/Chat';
import PersonIcon from '@mui/icons-material/Person';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LogoutIcon from '@mui/icons-material/Logout';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

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

const navItems = [
  { label: 'Chat', href: '/chat', icon: <ChatIcon /> },
  { label: 'About', href: '/about', icon: <InfoOutlinedIcon /> },
];

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, activityBarExtra, onChatClick }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { session, isLoggedIn, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/login');
    }
  }, [isLoading, isLoggedIn, router]);

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
          }}>
            CommsLink
          </Typography>
          <ConnectionStatus />
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
