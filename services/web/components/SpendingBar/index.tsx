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
  ec2: number;
};

const EC2_HOURLY_COST = 0.0464; // t2.medium us-east-2

const sections = [
  { key: 'grok' as const, label: 'Grok', color: '#b388ff', glowColor: 'rgba(179, 136, 255, 0.6)' },
  { key: 'elevenlabs' as const, label: '11Labs', color: '#00e676', glowColor: 'rgba(0, 230, 118, 0.6)' },
  { key: 'claude' as const, label: 'Claude', color: '#ff9100', glowColor: 'rgba(255, 145, 0, 0.6)' },
  { key: 'ec2' as const, label: 'EC2', color: '#42a5f5', glowColor: 'rgba(66, 165, 245, 0.6)' },
] as const;

const formatCost = (usd: number): string => {
  if (usd < 0.01) return '<1¢';
  if (usd < 1) return `${(usd * 100).toFixed(0)}¢`;
  return `$${usd.toFixed(2)}`;
};

const SpendingBar = () => {
  const { session, isLoggedIn } = useSession();
  const [spending, setSpending] = useState<SpendingData>({ grok: 0, elevenlabs: 0, claude: 0, ec2: EC2_HOURLY_COST });
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
      setSpending({ ...data, ec2: EC2_HOURLY_COST });
    };

    socket.on('spending_estimate', onSpending);

    fetchSpending();
    const interval = setInterval(fetchSpending, 60000);

    return () => {
      socket.off('spending_estimate', onSpending);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, session?.token]);

  if (!isLoggedIn) return null;

  const total = spending.grok + spending.elevenlabs + spending.claude + spending.ec2;

  // All sections always visible — minimum 15% each, rest distributed proportionally
  const getWidths = (): number[] => {
    const minPct = 15;
    const reserved = sections.length * minPct;
    const remaining = 100 - reserved;
    const raw = sections.map((s) => spending[s.key]);
    const rawTotal = raw.reduce((sum, v) => sum + v, 0);

    if (rawTotal === 0) return [25, 25, 25, 25];

    return raw.map((v) => minPct + (v / rawTotal) * remaining);
  };

  const widths = getWidths();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, mx: 'auto', gap: '2px' }}>
      {/* Total cost label */}
      <Typography
        sx={{
          fontSize: '0.55rem',
          fontWeight: 600,
          color: '#aaa',
          letterSpacing: '0.05em',
          lineHeight: 1,
        }}
      >
        {formatCost(total)}/hr
      </Typography>

      {/* Bar */}
      <Box
        sx={{
          display: 'flex',
          height: 18,
          borderRadius: '9px',
          overflow: 'hidden',
          backgroundColor: '#0a0a0a',
          border: '1px solid #333',
          width: 340,
        }}
      >
        {sections.map((section, i) => {
          const isHovered = hoveredSection === section.key;
          const width = widths[i];

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
                borderLeft: i > 0 ? `1px solid ${section.color}40` : 'none',
                boxShadow: `inset 0 0 6px ${section.glowColor}`,
                borderTop: `1px solid ${section.color}60`,
                borderBottom: `1px solid ${section.color}60`,
                ...(i === 0 && { borderLeft: `1px solid ${section.color}60` }),
                ...(i === sections.length - 1 && { borderRight: `1px solid ${section.color}60` }),
                transition: 'all 0.2s ease',
                '&:hover': {
                  backgroundColor: `${section.color}15`,
                  boxShadow: `inset 0 0 12px ${section.glowColor}, 0 0 8px ${section.glowColor}`,
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: '0.5rem',
                  fontWeight: 600,
                  color: section.color,
                  opacity: isHovered ? 1 : 0.7,
                  transition: 'opacity 0.2s ease',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  letterSpacing: '0.03em',
                  textShadow: isHovered ? `0 0 6px ${section.glowColor}` : 'none',
                }}
              >
                {isHovered ? `${section.label}: ${formatCost(spending[section.key])}/hr` : section.label}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default SpendingBar;
