'use client';

// Node modules
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// Libraries
import { getSocket } from '@/lib/socket';
import useSession from '@/lib/session/useSession';

const ConnectionStatus = () => {
  const { session, isLoggedIn } = useSession();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !session?.token) return;

    const socket = getSocket(session.token);
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  if (!isLoggedIn) return null;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.5,
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: connected ? '#4caf50' : '#f44336',
          boxShadow: connected ? '0 0 6px rgba(76, 175, 80, 0.6)' : '0 0 6px rgba(244, 67, 54, 0.6)',
        }}
      />
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          fontSize: '0.65rem',
          letterSpacing: '0.08em',
          color: connected ? '#4caf50' : '#f44336',
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        {connected ? 'ONLINE' : 'OFFLINE'}
      </Typography>
    </Box>
  );
};

export default ConnectionStatus;
