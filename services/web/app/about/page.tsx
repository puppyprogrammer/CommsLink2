'use client';

// React modules
import React from 'react';

// Node modules
import Link from 'next/link';

// Material UI components
import { Box, Container, Typography, Button, Paper, Stack } from '@mui/material';

// Material UI icons
import ChatIcon from '@mui/icons-material/Chat';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ForumIcon from '@mui/icons-material/Forum';
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';

// Libraries
import useSession from '@/lib/session/useSession';

const features = [
  { icon: <ChatIcon sx={{ fontSize: 32, color: '#569cd6' }} />, title: 'Real-Time Chat', description: 'Text and voice channels with live presence and notifications.' },
  { icon: <OndemandVideoIcon sx={{ fontSize: 32, color: '#569cd6' }} />, title: 'Watch Parties', description: 'Sync YouTube videos with friends in any channel.' },
  { icon: <SmartToyIcon sx={{ fontSize: 32, color: '#569cd6' }} />, title: 'AI Assistants', description: 'Chat with Kara, Claude, and other AI agents right inside your channels.' },
  { icon: <ForumIcon sx={{ fontSize: 32, color: '#569cd6' }} />, title: 'Forums', description: 'Threaded discussions for longer-form topics and knowledge sharing.' },
  { icon: <RecordVoiceOverIcon sx={{ fontSize: 32, color: '#569cd6' }} />, title: 'Premium Voices & Credits', description: 'Unlock high-quality TTS voices and AI features with credits.' },
];

const AboutPage = () => {
  const { isLoggedIn } = useSession();

  return (
    <Box sx={{ minHeight: '100vh', background: '#0a0e14', py: 6 }}>
      <Container maxWidth="md">
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="CommsLink" width={80} height={80} style={{ marginBottom: '1rem' }} />
          <Typography variant="h3" sx={{ fontFamily: "'Orbitron', monospace", color: '#4A148C', fontWeight: 400, mb: 1 }}>
            CommsLink
          </Typography>
          <Typography variant="body1" sx={{ color: '#858585', maxWidth: 480, mx: 'auto' }}>
            A real-time communication platform with text and voice chat, AI assistants, forums, and more.
          </Typography>
        </Box>

        <Stack spacing={2} sx={{ mb: 6 }}>
          {features.map((f) => (
            <Paper
              key={f.title}
              sx={{ p: 2.5, backgroundColor: '#161b22', border: '1px solid #333', display: 'flex', alignItems: 'center', gap: 2 }}
            >
              {f.icon}
              <Box>
                <Typography variant="body1" sx={{ color: '#ccc', fontWeight: 600 }}>{f.title}</Typography>
                <Typography variant="body2" sx={{ color: '#858585' }}>{f.description}</Typography>
              </Box>
            </Paper>
          ))}
        </Stack>

        <Box sx={{ textAlign: 'center' }}>
          {isLoggedIn ? (
            <Button
              component={Link}
              href="/chat"
              variant="contained"
              size="large"
              startIcon={<ChatIcon />}
              sx={{ px: 4 }}
            >
              Go to Chat
            </Button>
          ) : (
            <Stack direction="row" spacing={2} justifyContent="center">
              <Button
                component={Link}
                href="/register"
                variant="contained"
                size="large"
                sx={{ px: 4 }}
              >
                Create Account
              </Button>
              <Button
                component={Link}
                href="/login"
                variant="outlined"
                size="large"
                sx={{ px: 4 }}
              >
                Sign In
              </Button>
            </Stack>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default AboutPage;
