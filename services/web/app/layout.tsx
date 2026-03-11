// React modules
import React from 'react';

// Node modules
import type { Metadata } from 'next';

// Components
import Providers from './Providers';

// Styles
import '@/styles/globals.scss';

export const metadata: Metadata = {
  title: 'CommsLink',
  description: 'P2P Voice & Text Communication Platform',
  icons: {
    icon: '/logo.svg',
    apple: '/logo.svg',
  },
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
};

export default RootLayout;
