'use client';

// React modules
import React, { useEffect, useState } from 'react';

// Node modules
import { useRouter, useParams } from 'next/navigation';

// Material UI components
import { Box, Typography, CircularProgress } from '@mui/material';

// Libraries
import useSession from '@/lib/session/useSession';
import { getSocket } from '@/lib/socket';

const JoinPage = () => {
  const router = useRouter();
  const params = useParams();
  const token = (params?.token as string) || '';
  const { session, isLoading } = useSession();
  const [status, setStatus] = useState('Connecting...');

  useEffect(() => {
    if (isLoading) return;

    // Not logged in — redirect to login with return URL
    if (!session?.token) {
      router.replace(`/login?returnUrl=/join/${encodeURIComponent(token)}`);
      return;
    }

    // Logged in — emit join_by_invite via socket
    const socket = getSocket(session.token);
    setStatus('Joining room...');

    const handleJoined = () => {
      router.replace('/chat');
    };

    const handleError = (data: { error: string }) => {
      setStatus(data.error);
    };

    socket.once('room_joined', handleJoined);
    socket.once('room_join_error', handleError);
    socket.emit('join_by_invite', { token });

    return () => {
      socket.off('room_joined', handleJoined);
      socket.off('room_join_error', handleError);
    };
  }, [isLoading, session?.token, token, router]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 2,
      }}
    >
      {status === 'Connecting...' || status === 'Joining room...' ? (
        <CircularProgress size={32} />
      ) : null}
      <Typography variant="h6">{status}</Typography>
    </Box>
  );
};

export default JoinPage;
