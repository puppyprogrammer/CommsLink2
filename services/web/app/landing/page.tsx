'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Typography, Button, Container } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import ApiIcon from '@mui/icons-material/Api';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';

const products = [
  {
    name: 'CommsLink Chat',
    tagline: 'Voice AI Agents + Remote Terminals',
    description: 'Talk to autonomous AI agents that execute commands on your servers. Deploy agents, manage infrastructure, and collaborate — all through voice.',
    icon: <SmartToyIcon sx={{ fontSize: 48 }} />,
    href: '/chat',
    cta: 'Launch App',
    color: '#4dd8d0',
    live: true,
  },
  {
    name: 'FFXIVoices',
    tagline: 'AI Voices for FFXIV Roleplayers',
    description: 'Give your FFXIV character a voice. Every player selects a unique AI voice — party chat, /say, and RP dialogue spoken aloud to everyone nearby.',
    icon: <SportsEsportsIcon sx={{ fontSize: 48 }} />,
    href: '/ffxivoices',
    cta: 'Coming Soon',
    color: '#b388ff',
    live: false,
  },
  {
    name: 'Voice API',
    tagline: 'TTS + STT + Sentiment for Developers',
    description: 'Speech-to-text, sentiment analysis, and emotion-aware text-to-speech in one API. Powered by Amazon Transcribe, Comprehend, and Polly.',
    icon: <ApiIcon sx={{ fontSize: 48 }} />,
    href: '/api',
    cta: 'Coming Soon',
    color: '#f0883e',
    live: false,
  },
];

const LandingPage = () => {
  const router = useRouter();
  const [stats, setStats] = useState<{ users: number; rooms: number; agents: number } | null>(null);

  useEffect(() => {
    fetch('/api/v1/stats').then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

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
        pt: { xs: 10, md: 16 },
        pb: { xs: 6, md: 10 },
        textAlign: 'center',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: '40%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '700px',
          height: '700px',
          background: 'radial-gradient(circle, rgba(77,216,208,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        },
      }}>
        <Container maxWidth="md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="CommsLink"
            width={90}
            height={90}
            style={{
              marginBottom: '1.5rem',
              filter: 'drop-shadow(0 0 25px rgba(77,216,208,0.5)) drop-shadow(0 0 50px rgba(77,216,208,0.25))',
            }}
          />
          <Typography sx={{
            fontFamily: "'Orbitron', monospace",
            fontWeight: 700,
            color: '#4dd8d0',
            textShadow: '0 0 25px rgba(77,216,208,0.4), 0 0 60px rgba(77,216,208,0.15)',
            fontSize: { xs: '2.2rem', md: '3.5rem' },
            mb: 2,
          }}>
            CommsLink
          </Typography>
          <Typography sx={{
            color: '#8ba4bd',
            fontWeight: 300,
            fontSize: { xs: '1rem', md: '1.3rem' },
            maxWidth: 550,
            mx: 'auto',
            mb: 1,
            lineHeight: 1.6,
          }}>
            Voice AI technology for people and games
          </Typography>
          <Typography sx={{
            color: '#556b82',
            fontSize: { xs: '0.85rem', md: '0.95rem' },
            maxWidth: 480,
            mx: 'auto',
            mb: 5,
            lineHeight: 1.7,
          }}>
            We build voice-powered AI systems — from autonomous agents that control your servers to immersive character voices for gaming.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              size="large"
              onClick={() => router.push('/register')}
              sx={{
                px: 5, py: 1.5, fontSize: '1rem', fontWeight: 'bold',
                background: 'linear-gradient(135deg, #4dd8d0 0%, #3ab8b0 100%)',
                color: '#0a1929',
                boxShadow: '0 0 20px rgba(77,216,208,0.3)',
                '&:hover': { background: 'linear-gradient(135deg, #5de8e0 0%, #4ac8c0 100%)', boxShadow: '0 0 30px rgba(77,216,208,0.5)' },
              }}
            >
              Get Started Free
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={() => router.push('/login')}
              sx={{
                px: 4, py: 1.5, fontSize: '1rem',
                borderColor: 'rgba(77,216,208,0.3)', color: '#4dd8d0',
                '&:hover': { borderColor: 'rgba(77,216,208,0.6)', background: 'rgba(77,216,208,0.05)' },
              }}
            >
              Sign In
            </Button>
          </Box>
        </Container>
      </Box>

      {/* Products */}
      <Container maxWidth="lg" sx={{ pb: { xs: 6, md: 10 } }}>
        <Typography sx={{
          textAlign: 'center',
          mb: 5,
          fontFamily: "'Orbitron', monospace",
          fontWeight: 400,
          color: '#4dd8d0',
          fontSize: { xs: '1.1rem', md: '1.5rem' },
          textShadow: '0 0 10px rgba(77,216,208,0.2)',
        }}>
          Our Products
        </Typography>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          gap: 3,
        }}>
          {products.map((p) => (
            <Box
              key={p.name}
              sx={{
                p: 4,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${p.live ? `${p.color}20` : 'rgba(255,255,255,0.05)'}`,
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                '&:hover': {
                  background: `${p.color}08`,
                  borderColor: `${p.color}40`,
                  transform: 'translateY(-3px)',
                },
              }}
            >
              <Box sx={{ color: p.color, mb: 2, opacity: p.live ? 1 : 0.5 }}>{p.icon}</Box>
              <Typography sx={{ fontSize: '1.2rem', fontWeight: 700, mb: 0.5, color: p.live ? '#e0e8f0' : '#6688aa' }}>
                {p.name}
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: p.color, mb: 1.5, fontWeight: 500 }}>
                {p.tagline}
              </Typography>
              <Typography sx={{ fontSize: '0.85rem', color: '#6688aa', lineHeight: 1.7, mb: 3, flex: 1 }}>
                {p.description}
              </Typography>
              <Button
                variant={p.live ? 'contained' : 'outlined'}
                onClick={() => p.live ? router.push(p.href) : null}
                disabled={!p.live}
                sx={{
                  alignSelf: 'flex-start',
                  ...(p.live ? {
                    background: `linear-gradient(135deg, ${p.color} 0%, ${p.color}cc 100%)`,
                    color: '#0a1929',
                    fontWeight: 700,
                    '&:hover': { boxShadow: `0 0 15px ${p.color}40` },
                  } : {
                    borderColor: 'rgba(255,255,255,0.1)',
                    color: '#556b82',
                  }),
                }}
              >
                {p.cta}
              </Button>
            </Box>
          ))}
        </Box>
      </Container>

      {/* Technology section */}
      <Box sx={{ py: { xs: 5, md: 8 }, borderTop: '1px solid rgba(77,216,208,0.06)', background: 'rgba(0,0,0,0.15)' }}>
        <Container maxWidth="md">
          <Typography sx={{
            textAlign: 'center', mb: 4,
            fontFamily: "'Orbitron', monospace", fontWeight: 400,
            color: '#4dd8d0', fontSize: { xs: '1rem', md: '1.3rem' },
          }}>
            Built With
          </Typography>
          <Box sx={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: { xs: 3, md: 5 },
          }}>
            {[
              { name: 'Amazon Transcribe', desc: 'Real-time speech-to-text' },
              { name: 'Amazon Comprehend', desc: 'Sentiment analysis' },
              { name: 'Amazon Polly', desc: 'Emotion-aware TTS' },
              { name: 'Claude (Anthropic)', desc: 'AI reasoning' },
              { name: 'Grok (xAI)', desc: 'AI reasoning' },
            ].map((tech) => (
              <Box key={tech.name} sx={{ textAlign: 'center', minWidth: 100 }}>
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: '#8ba4bd' }}>
                  {tech.name}
                </Typography>
                <Typography sx={{ fontSize: '0.65rem', color: '#556b82' }}>
                  {tech.desc}
                </Typography>
              </Box>
            ))}
          </Box>
        </Container>
      </Box>

      {/* CTA */}
      <Box sx={{ py: { xs: 6, md: 10 }, textAlign: 'center' }}>
        <Container maxWidth="sm">
          <RecordVoiceOverIcon sx={{ fontSize: 48, color: '#4dd8d0', mb: 2, opacity: 0.6 }} />
          <Typography sx={{ mb: 2, fontWeight: 600, fontSize: { xs: '1.1rem', md: '1.4rem' } }}>
            The future of communication is voice + AI
          </Typography>
          <Typography sx={{ color: '#556b82', mb: 4, fontSize: '0.9rem' }}>
            Free account. 10,000 credits. No credit card.
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={() => router.push('/register')}
            sx={{
              px: 6, py: 1.5, fontSize: '1rem', fontWeight: 'bold',
              background: 'linear-gradient(135deg, #4dd8d0 0%, #3ab8b0 100%)',
              color: '#0a1929',
              boxShadow: '0 0 20px rgba(77,216,208,0.3)',
              '&:hover': { background: 'linear-gradient(135deg, #5de8e0 0%, #4ac8c0 100%)', boxShadow: '0 0 30px rgba(77,216,208,0.5)' },
            }}
          >
            Get Started Free
          </Button>
        </Container>
      </Box>

      {/* Stats */}
      {stats && (stats.users > 0 || stats.rooms > 0 || stats.agents > 0) && (
        <Box sx={{ py: 4, borderTop: '1px solid rgba(77,216,208,0.06)', background: 'rgba(0,0,0,0.15)' }}>
          <Container maxWidth="sm">
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: { xs: 4, sm: 8 } }}>
              {[
                { label: 'Users', value: stats.users },
                { label: 'Rooms', value: stats.rooms },
                { label: 'AI Agents', value: stats.agents },
              ].map((s) => (
                <Box key={s.label} sx={{ textAlign: 'center' }}>
                  <Typography sx={{
                    fontSize: { xs: '1.2rem', sm: '1.5rem' }, fontWeight: 700,
                    color: '#4dd8d0', fontFamily: "'Orbitron', monospace",
                  }}>
                    {s.value.toLocaleString()}
                  </Typography>
                  <Typography sx={{ fontSize: '0.7rem', color: '#556b82', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {s.label}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Container>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ py: 3, textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, mb: 1.5 }}>
          <Typography component={Link} href="/privacy" sx={{ color: '#445566', fontSize: '0.7rem', textDecoration: 'none', '&:hover': { color: '#4dd8d0' } }}>
            Privacy Policy
          </Typography>
          <Typography component={Link} href="/terms" sx={{ color: '#445566', fontSize: '0.7rem', textDecoration: 'none', '&:hover': { color: '#4dd8d0' } }}>
            Terms of Service
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: '#334455' }}>
          CommsLink &copy; {new Date().getFullYear()}
        </Typography>
      </Box>
    </Box>
  );
};

export default LandingPage;
