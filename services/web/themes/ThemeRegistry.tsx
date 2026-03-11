'use client';

// React modules
import React, { useState } from 'react';

// Node modules
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { useServerInsertedHTML } from 'next/navigation';

// Libraries
import LightTheme from './LightTheme';

type ThemeRegistryProps = {
  children: React.ReactNode;
};

const ThemeRegistry: React.FC<ThemeRegistryProps> = ({ children }) => {
  const [cache] = useState(() => {
    const c = createCache({ key: 'mui' });
    c.compat = true;
    return c;
  });

  useServerInsertedHTML(() => {
    const names = Object.keys(cache.inserted);
    if (names.length === 0) return null;
    let styles = '';
    for (const name of names) {
      if (cache.inserted[name] && typeof cache.inserted[name] === 'string') {
        styles += cache.inserted[name];
      }
    }
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(' ')}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={LightTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
};

export default ThemeRegistry;
