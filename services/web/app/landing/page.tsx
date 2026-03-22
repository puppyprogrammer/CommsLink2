'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Box, Typography, Button, Container } from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SecurityIcon from '@mui/icons-material/Security';
import SpeedIcon from '@mui/icons-material/Speed';
import GroupsIcon from '@mui/icons-material/Groups';

const features = [
  {
    icon: <RecordVoiceOverIcon sx={{ fontSize: 36 }} />,
    title: 'Voice-Controlled AI',
    desc: 'Talk to AI agents with real-time text-to-speech. Give commands with your voice, hear responses spoken back.',
  },
  {
    icon: <TerminalIcon sx={{ fontSize: 36 }} />,
    title: 'Remote Terminal Access',
    desc: 'Execute commands on any machine from anywhere. Your AI agents can run shell commands, scripts, and even spawn Claude Code sessions.',
  },
  {
    icon: <SmartToyIcon sx={{ fontSize: 36 }} />,
    title: 'Autonomous AI Agents',
    desc: 'Deploy AI agents that think, remember, and act on their own. They monitor themselves for drift and maintain memory coherence.',
  },
  {
    icon: <SecurityIcon sx={{ fontSize: 36 }} />,
    title: 'Security Classification',
    desc: 'Every terminal command is classified by AI before execution. Dangerous commands require approval. Blocked commands never run.',
  },
  {
    icon: <SpeedIcon sx={{ fontSize: 36 }} />,
    title: 'Real-Time Everything',
    desc: 'Built on Socket.IO for instant messaging, live terminal output, and real-time voice. No polling, no delays.',
  },
  {
    icon: <GroupsIcon sx={{ fontSize: 36 }} />,
    title: 'Team Rooms',
    desc: 'Create rooms with multiple AI agents and team members. Share terminal access, collaborate with voice, and manage agents together.',
  },
];

const LandingPage = () => {
  const router = useRouter();

  return (
    <Box sx={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #050d1a 0%, #0a1929 40%, #0d2137 100%)',
      color: '#e0e8f0',
      overflow: 'hidden',
    }}>
      {/* Hero */}
      <Box sx={{
        position: 'relative',
        pt: { xs: 8, md: 14 },
        pb: { xs: 8, md: 12 },
        textAlign: 'center',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '600px',
          background: 'radial-gradient(circle, rgba(77,216,208,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        },
      }}>
        <Container maxWidth="md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="CommsLink"
            width={80}
            height={80}
            style={{
              marginBottom: '1.5rem',
              filter: 'drop-shadow(0 0 20px rgba(77,216,208,0.6)) drop-shadow(0 0 40px rgba(77,216,208,0.3))',
            }}
          />
          <Typography variant="h2" sx={{
            fontFamily: "'Orbitron', monospace",
            fontWeight: 700,
            color: '#4dd8d0',
            textShadow: '0 0 20px rgba(77,216,208,0.4), 0 0 60px rgba(77,216,208,0.2)',
            fontSize: { xs: '2rem', md: '3.2rem' },
            mb: 2,
          }}>
            CommsLink
          </Typography>
          <Typography variant="h5" sx={{
            color: '#8ba4bd',
            fontWeight: 300,
            maxWidth: 600,
            mx: 'auto',
            mb: 1.5,
            fontSize: { xs: '1.1rem', md: '1.4rem' },
            lineHeight: 1.5,
          }}>
            Talk to AI. Control your machines.
          </Typography>
          <Typography variant="body1" sx={{
            color: '#556b82',
            maxWidth: 520,
            mx: 'auto',
            mb: 5,
            fontSize: { xs: '0.9rem', md: '1rem' },
            lineHeight: 1.7,
          }}>
            Voice-powered AI agents that execute commands on your remote machines.
            Deploy autonomous agents, manage servers, and collaborate with your team — all through chat.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              size="large"
              onClick={() => router.push('/register')}
              sx={{
                px: 5,
                py: 1.5,
                fontSize: '1.05rem',
                fontWeight: 'bold',
                background: 'linear-gradient(135deg, #4dd8d0 0%, #3ab8b0 100%)',
                color: '#0a1929',
                boxShadow: '0 0 20px rgba(77,216,208,0.3), 0 4px 15px rgba(0,0,0,0.3)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #5de8e0 0%, #4ac8c0 100%)',
                  boxShadow: '0 0 30px rgba(77,216,208,0.5), 0 4px 20px rgba(0,0,0,0.4)',
                },
              }}
            >
              Get Started Free
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={() => router.push('/login')}
              sx={{
                px: 4,
                py: 1.5,
                fontSize: '1.05rem',
                borderColor: 'rgba(77,216,208,0.3)',
                color: '#4dd8d0',
                '&:hover': {
                  borderColor: 'rgba(77,216,208,0.6)',
                  background: 'rgba(77,216,208,0.05)',
                },
              }}
            >
              Sign In
            </Button>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: '#445566' }}>
            10,000 free credits included. No credit card required.
          </Typography>
        </Container>
      </Box>

      {/* Terminal mockup */}
      <Container maxWidth="sm" sx={{ mb: { xs: 8, md: 12 } }}>
        <Box sx={{
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(77,216,208,0.15)',
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: '0 0 30px rgba(77,216,208,0.05), 0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <Box sx={{
            background: 'rgba(77,216,208,0.06)',
            px: 2,
            py: 0.75,
            display: 'flex',
            gap: 0.75,
            alignItems: 'center',
          }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: '#28ca42' }} />
            <Typography variant="caption" sx={{ ml: 1, color: '#556b82', fontFamily: 'monospace' }}>
              commslink
            </Typography>
          </Box>
          <Box sx={{ p: 2.5, fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 2 }}>
            <Box component="span" sx={{ color: '#4dd8d0' }}>you:</Box>
            <Box component="span" sx={{ color: '#8ba4bd' }}> Hey Kara, check if nginx is running on the production server</Box>
            <br />
            <Box component="span" sx={{ color: '#f0883e' }}>Kara:</Box>
            <Box component="span" sx={{ color: '#8ba4bd' }}> On it. Running status check now...</Box>
            <br />
            <Box component="span" sx={{ color: '#556b82' }}>[Kara executed: systemctl status nginx]</Box>
            <br />
            <Box component="span" sx={{ color: '#f0883e' }}>Kara:</Box>
            <Box component="span" sx={{ color: '#8ba4bd' }}> Nginx is active and running. Uptime 14 days. No errors in the last 1000 lines of the access log.</Box>
          </Box>
        </Box>
      </Container>

      {/* Features grid */}
      <Container maxWidth="lg" sx={{ pb: { xs: 8, md: 14 } }}>
        <Typography variant="h4" sx={{
          textAlign: 'center',
          mb: 6,
          fontFamily: "'Orbitron', monospace",
          fontWeight: 400,
          color: '#4dd8d0',
          fontSize: { xs: '1.3rem', md: '1.8rem' },
          textShadow: '0 0 10px rgba(77,216,208,0.3)',
        }}>
          Built for operators
        </Typography>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          gap: 3,
        }}>
          {features.map((f) => (
            <Box
              key={f.title}
              sx={{
                p: 3.5,
                borderRadius: 2,
                background: 'rgba(77,216,208,0.03)',
                border: '1px solid rgba(77,216,208,0.08)',
                transition: 'all 0.2s ease',
                '&:hover': {
                  background: 'rgba(77,216,208,0.06)',
                  borderColor: 'rgba(77,216,208,0.2)',
                  transform: 'translateY(-2px)',
                },
              }}
            >
              <Box sx={{ color: '#4dd8d0', mb: 2 }}>{f.icon}</Box>
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 600, fontSize: '1rem' }}>
                {f.title}
              </Typography>
              <Typography variant="body2" sx={{ color: '#6688aa', lineHeight: 1.7 }}>
                {f.desc}
              </Typography>
            </Box>
          ))}
        </Box>
      </Container>

      {/* Bottom CTA */}
      <Box sx={{
        py: { xs: 6, md: 10 },
        textAlign: 'center',
        borderTop: '1px solid rgba(77,216,208,0.06)',
        background: 'rgba(0,0,0,0.2)',
      }}>
        <Container maxWidth="sm">
          <Typography variant="h5" sx={{
            mb: 2,
            fontWeight: 600,
            fontSize: { xs: '1.2rem', md: '1.5rem' },
          }}>
            Ready to command your infrastructure with voice?
          </Typography>
          <Typography variant="body2" sx={{ color: '#556b82', mb: 4 }}>
            Set up in under a minute. Deploy an AI agent, connect a machine, start talking.
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={() => router.push('/register')}
            sx={{
              px: 6,
              py: 1.5,
              fontSize: '1.05rem',
              fontWeight: 'bold',
              background: 'linear-gradient(135deg, #4dd8d0 0%, #3ab8b0 100%)',
              color: '#0a1929',
              boxShadow: '0 0 20px rgba(77,216,208,0.3)',
              '&:hover': {
                background: 'linear-gradient(135deg, #5de8e0 0%, #4ac8c0 100%)',
                boxShadow: '0 0 30px rgba(77,216,208,0.5)',
              },
            }}
          >
            Get Started Free
          </Button>
        </Container>
      </Box>

      {/* Footer */}
      <Box sx={{ py: 3, textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
        <Typography variant="caption" sx={{ color: '#334455' }}>
          CommsLink &copy; {new Date().getFullYear()}
        </Typography>
      </Box>
    </Box>
  );
};

export default LandingPage;
