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
          <img src="/logo.svg" alt="CommsLink" width={80} height={80} style={{ marginBottom: '0.5rem' }} />
          <Typography variant="h3" sx={{ color: 'primary.main', fontWeight: 700 }}>
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
