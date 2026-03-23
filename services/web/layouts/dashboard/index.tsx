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
import { getSocket } from '@/lib/socket';
import { getRoomIcon } from '@/lib/helpers/roomIcon';

// Components
import ConnectionStatus from '@/components/ConnectionStatus';
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';

// Styles
import classes from './Dashboard.module.scss';

const ACTIVITY_BAR_WIDTH = 48;

type Room = { name: string; displayName: string; users: number; hasPassword: boolean; isPublic: boolean; createdBy: string | null };

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
  const [rooms, setRooms] = useState<Room[]>([]);

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

  // Load rooms via socket for non-chat pages
  useEffect(() => {
    if (!session?.token || activityBarExtra || pathname === '/chat') return;
    const socket = getSocket(session.token);
    const handleRooms = (data: { rooms: Room[] } | Room[]) => {
      const list = Array.isArray(data) ? data : data.rooms;
      if (Array.isArray(list)) setRooms(list);
    };
    socket.on('room_list', handleRooms);
    socket.on('room_list_update', handleRooms);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off('room_list', handleRooms);
      socket.off('room_list_update', handleRooms);
    };
  }, [session?.token, activityBarExtra, pathname]);

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
          {activityBarExtra || (<>{rooms.filter((r) => r.name !== 'public').map((room) => {
            const icon = getRoomIcon(room.displayName);
            return (
              <Tooltip key={room.name} title={`${room.displayName} (${room.users})`} placement="right">
                <Box
                  onClick={() => router.push(`/chat?joinRoom=${encodeURIComponent(room.name)}`)}
                  sx={{
                    position: 'relative',
                    width: 28,
                    height: 28,
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '0.55rem',
                    fontWeight: 700,
                    color: '#fff',
                    bgcolor: icon.bgColor,
                    transition: 'transform 0.1s',
                    '&:hover': { transform: 'scale(1.08)' },
                    flexShrink: 0,
                    userSelect: 'none',
                  }}
                >
                  {icon.initials}
                  {room.users > 0 && (
                    <Box sx={{
                      position: 'absolute', top: -3, right: -4,
                      minWidth: 12, height: 12, borderRadius: 6,
                      bgcolor: '#007acc', color: '#fff',
                      fontSize: '0.45rem', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      px: '2px', pointerEvents: 'none',
                    }}>
                      {room.users}
                    </Box>
                  )}
                  {room.hasPassword && !room.isPublic && (
                    <Box sx={{
                      position: 'absolute', bottom: -2, left: -2,
                      width: 12, height: 12, bgcolor: 'background.paper',
                      borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                    }}>
                      <LockIcon sx={{ fontSize: 10, color: '#aaa' }} />
                    </Box>
                  )}
                </Box>
              </Tooltip>
            );
          })}
          <Tooltip title="Create Room" placement="right">
            <Box
              onClick={() => router.push('/chat?createRoom=true')}
              sx={{
                width: 28, height: 28, borderRadius: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
                bgcolor: 'transparent', color: '#858585',
                border: '1px dashed rgba(255,255,255,0.15)',
                transition: 'all 0.15s',
                '&:hover': { color: '#fff', borderColor: '#858585' },
              }}
            >
              <AddIcon sx={{ fontSize: 16 }} />
            </Box>
          </Tooltip>
          </>)}
        </Box>
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
