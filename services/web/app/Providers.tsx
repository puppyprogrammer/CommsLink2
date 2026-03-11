'use client';

// React modules
import React from 'react';

// Node modules
import { SWRConfig } from 'swr';

// Libraries
import ThemeRegistry from '@/themes/ThemeRegistry';
import { PreferencesProvider } from '@/lib/state/PreferencesContext';
import { ToastProvider } from '@/lib/state/ToastContext';

type ProvidersProps = {
  children: React.ReactNode;
};

const Providers: React.FC<ProvidersProps> = ({ children }) => {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        shouldRetryOnError: false,
      }}
    >
      <ThemeRegistry>
        <ToastProvider>
          <PreferencesProvider>{children}</PreferencesProvider>
        </ToastProvider>
      </ThemeRegistry>
    </SWRConfig>
  );
};

export default Providers;
