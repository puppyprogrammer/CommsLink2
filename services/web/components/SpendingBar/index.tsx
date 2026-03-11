'use client';

import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { getSocket } from '@/lib/socket';
import useSession from '@/lib/session/useSession';

type SpendingData = {
  grok: number;
  elevenlabs: number;
  claude: number;
};

const sections = [
  { key: 'grok' as const, label: 'Grok', color: '#b388ff', glowColor: 'rgba(179, 136, 255, 0.6)' },
  { key: 'elevenlabs' as const, label: 'ElevenLabs', color: '#00e676', glowColor: 'rgba(0, 230, 118, 0.6)' },
  { key: 'claude' as const, label: 'Claude', color: '#ff9100', glowColor: 'rgba(255, 145, 0, 0.6)' },
] as const;

const formatCost = (usd: number): string => {
  if (usd < 0.01) return '<$0.01/hr';
  return `$${usd.toFixed(2)}/hr`;
};

const SpendingBar = () => {
  const { session, isLoggedIn } = useSession();
  const [spending, setSpending] = useState<SpendingData>({ grok: 0, elevenlabs: 0, claude: 0 });
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);

  const fetchSpending = useCallback(() => {
    if (!session?.token) return;
    const socket = getSocket(session.token);
    if (socket.connected) {
      socket.emit('get_spending_estimate');
    }
  }, [session?.token]);

  useEffect(() => {
    if (!isLoggedIn || !session?.token) return;

    const socket = getSocket(session.token);

    const onSpending = (data: SpendingData) => {
      setSpending(data);
    };

    socket.on('spending_estimate', onSpending);

    // Fetch immediately and then every 60 seconds
    fetchSpending();
    const interval = setInterval(fetchSpending, 60000);

    return () => {
      socket.off('spending_estimate', onSpending);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, session?.token]);

  if (!isLoggedIn) return null;

  const total = spending.grok + spending.elevenlabs + spending.claude;

  // Calculate proportional widths — minimum 10% each if non-zero, equal if all zero
  const getWidths = (): number[] => {
    if (total === 0) return [33.33, 33.34, 33.33];
    const raw = sections.map((s) => spending[s.key]);
    const minPct = 10;
    const nonZeroCount = raw.filter((v) => v > 0).length;
    if (nonZeroCount === 0) return [33.33, 33.34, 33.33];

    // Give minimum percentage to non-zero, distribute rest proportionally
    const reserved = nonZeroCount * minPct;
    const remaining = 100 - reserved;
    const nonZeroTotal = raw.reduce((sum, v) => sum + v, 0);

    return raw.map((v) => {
      if (v === 0) return 0;
      return minPct + (v / nonZeroTotal) * remaining;
    });
  };

  const widths = getWidths();

  return (
    <Box
      sx={{
        display: 'flex',
        height: 24,
        borderRadius: '12px',
        overflow: 'hidden',
        backgroundColor: '#0a0a0a',
        border: '1px solid #333',
        width: 320,
        flexShrink: 0,
        mx: 'auto',
      }}
    >
      {sections.map((section, i) => {
        const isHovered = hoveredSection === section.key;
        const width = widths[i];
        if (width === 0) return null;

        return (
          <Box
            key={section.key}
            onMouseEnter={() => setHoveredSection(section.key)}
            onMouseLeave={() => setHoveredSection(null)}
            sx={{
              width: `${width}%`,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              cursor: 'default',
              borderLeft: i > 0 ? `1px solid ${section.color}` : 'none',
              borderRight: i < sections.length - 1 ? 'none' : 'none',
              boxShadow: `inset 0 0 8px ${section.glowColor}, 0 0 4px ${section.glowColor}`,
              borderTop: `1px solid ${section.color}`,
              borderBottom: `1px solid ${section.color}`,
              ...(i === 0 && { borderLeft: `1px solid ${section.color}` }),
              ...(i === sections.length - 1 && { borderRight: `1px solid ${section.color}` }),
              transition: 'all 0.2s ease',
              '&:hover': {
                backgroundColor: `${section.color}15`,
                boxShadow: `inset 0 0 12px ${section.glowColor}, 0 0 8px ${section.glowColor}`,
              },
            }}
          >
            <Typography
              sx={{
                fontSize: '0.6rem',
                fontWeight: 600,
                color: section.color,
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.2s ease',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                letterSpacing: '0.03em',
              }}
            >
              {section.label}: {formatCost(spending[section.key])}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
};

export default SpendingBar;
