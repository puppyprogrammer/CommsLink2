'use client';

// React modules
import React from 'react';

// Material UI components
import { Box, Container, Paper, Typography } from '@mui/material';

// Styles
import classes from './PromptLayout.module.scss';

type PromptLayoutProps = {
  children: React.ReactNode;
  title?: string;
};

const PromptLayout: React.FC<PromptLayoutProps> = ({ children, title }) => {
  return (
    <Box className={classes.root}>
      <Container maxWidth="sm">
        <Box className={classes.logoContainer}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="CommsLink" width={80} height={80} style={{
            marginBottom: '0.5rem',
            filter: 'drop-shadow(0 0 12px rgba(77, 216, 208, 0.6)) drop-shadow(0 0 30px rgba(77, 216, 208, 0.3))',
            animation: 'logoGlow 3s ease-in-out infinite alternate',
          }} />
          <style>{`
            @keyframes logoGlow {
              from { filter: drop-shadow(0 0 12px rgba(77, 216, 208, 0.4)) drop-shadow(0 0 25px rgba(77, 216, 208, 0.2)); }
              to { filter: drop-shadow(0 0 18px rgba(77, 216, 208, 0.8)) drop-shadow(0 0 40px rgba(77, 216, 208, 0.4)); }
            }
          `}</style>
          <Typography variant="h3" sx={{
            fontFamily: "'Orbitron', monospace", color: '#4dd8d0', fontWeight: 400,
            textShadow: '0 0 15px rgba(77, 216, 208, 0.5), 0 0 30px rgba(77, 216, 208, 0.3)',
          }}>
            CommsLink
          </Typography>
          <Typography variant="detailText">Voice & Text Communication</Typography>
        </Box>
        <Paper className={classes.card} elevation={4}>
          {title && (
            <Typography variant="h5" className={classes.title}>
              {title}
            </Typography>
          )}
          {children}
        </Paper>
      </Container>
    </Box>
  );
};

export default PromptLayout;
