'use client';

// React modules
import React from 'react';

// Node modules
import Link from 'next/link';

// Material UI components
import { Box, Container, Typography, Button, Paper, Stack } from '@mui/material';

// Material UI icons
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TerminalIcon from '@mui/icons-material/Terminal';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';

// Libraries
import useSession from '@/lib/session/useSession';

const features = [
  {
    icon: <AddCircleOutlineIcon sx={{ fontSize: 32, color: '#569cd6' }} />,
    title: 'Create Your Own Room',
    description: 'Set up private rooms, invite members, and configure AI agents tailored to your workflow.',
  },
  {
    icon: <SmartToyIcon sx={{ fontSize: 32, color: '#569cd6' }} />,
    title: 'Deploy AI Agents',
    description: 'Add autonomous AI agents to your room — they think, plan, and act on your behalf around the clock.',
  },
  {
    icon: <TerminalIcon sx={{ fontSize: 32, color: '#569cd6' }} />,
    title: 'Remote Terminals & Claude',
    description:
      'Connect machines, run commands remotely, and dispatch Claude Code sessions to build and deploy software.',
  },
  {
    icon: <ViewInArIcon sx={{ fontSize: 32, color: '#569cd6' }} />,
    title: 'Holographic Avatars',
    description: 'Give your agents a 3D holographic body with real-time emotion, pose, and animation.',
  },
  {
    icon: <RecordVoiceOverIcon sx={{ fontSize: 32, color: '#569cd6' }} />,
    title: 'Voice & Credits',
    description: 'Premium TTS voices, AI-powered features, and a credit system to manage usage.',
  },
];

const AboutPage = () => {
  const { isLoggedIn } = useSession();

  return (
    <Box sx={{ minHeight: '100vh', background: '#0a0e14', py: 6 }}>
      <Container maxWidth="md">
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="CommsLink" width={80} height={80} style={{
            marginBottom: '1rem',
            filter: 'drop-shadow(0 0 12px rgba(77, 216, 208, 0.6)) drop-shadow(0 0 30px rgba(77, 216, 208, 0.3))',
            animation: 'logoGlow 3s ease-in-out infinite alternate',
          }} />
          <style>{`
            @keyframes logoGlow {
              from { filter: drop-shadow(0 0 12px rgba(77, 216, 208, 0.4)) drop-shadow(0 0 25px rgba(77, 216, 208, 0.2)); }
              to { filter: drop-shadow(0 0 18px rgba(77, 216, 208, 0.8)) drop-shadow(0 0 40px rgba(77, 216, 208, 0.4)); }
            }
          `}</style>
          <Typography
            variant="h3"
            sx={{
              fontFamily: "'Orbitron', monospace",
              color: '#4dd8d0',
              fontWeight: 400,
              mb: 1,
              textShadow: '0 0 15px rgba(77, 216, 208, 0.5), 0 0 30px rgba(77, 216, 208, 0.3)',
            }}
          >
            CommsLink
          </Typography>
          <Typography variant="body1" sx={{ color: '#858585', maxWidth: 520, mx: 'auto' }}>
            Your own AI command center. Create a room, deploy autonomous agents, and put them to work on remote machines
            with Claude Code.
          </Typography>
        </Box>

        <Stack spacing={2} sx={{ mb: 6 }}>
          {features.map((f) => (
            <Paper
              key={f.title}
              sx={{
                p: 2.5,
                backgroundColor: '#161b22',
                border: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              {f.icon}
              <Box>
                <Typography variant="body1" sx={{ color: '#ccc', fontWeight: 600 }}>
                  {f.title}
                </Typography>
                <Typography variant="body2" sx={{ color: '#858585' }}>
                  {f.description}
                </Typography>
              </Box>
            </Paper>
          ))}
        </Stack>

        <Box sx={{ textAlign: 'center' }}>
          {isLoggedIn ? (
            <Link href="/chat" style={{ textDecoration: 'none' }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<AddCircleOutlineIcon />}
                sx={{ px: 4, fontSize: '1.1rem' }}
              >
                Create a Room
              </Button>
            </Link>
          ) : (
            <Stack spacing={2} alignItems="center">
              <Typography variant="body1" sx={{ color: '#ccc' }}>
                Get started — create an account and set up your first room.
              </Typography>
              <Stack direction="row" spacing={2} justifyContent="center">
                <Button
                  component={Link}
                  href="/register"
                  variant="contained"
                  size="large"
                  startIcon={<AddCircleOutlineIcon />}
                  sx={{ px: 4 }}
                >
                  Create Account
                </Button>
                <Button component={Link} href="/login" variant="outlined" size="large" sx={{ px: 4 }}>
                  Sign In
                </Button>
              </Stack>
            </Stack>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default AboutPage;
