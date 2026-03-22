// React modules
import React from 'react';

// Node modules
import type { Metadata } from 'next';

// Components
import Providers from './Providers';

// Styles
import '@/styles/globals.scss';

export const metadata: Metadata = {
  title: 'CommsLink — Voice-Controlled AI Agents for Remote Terminals',
  description: 'Talk to AI agents that execute commands on your servers. Voice-powered terminal control, autonomous agents, and real-time collaboration.',
  icons: {
    icon: '/logo.svg',
    apple: '/logo.svg',
  },
  metadataBase: new URL('https://commslink.net'),
  openGraph: {
    title: 'CommsLink — Talk to AI. Control Your Machines.',
    description: 'Voice-powered AI agents that execute commands on your remote servers. Deploy autonomous agents, manage infrastructure, collaborate with your team.',
    url: 'https://commslink.net',
    siteName: 'CommsLink',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'CommsLink — Voice AI Terminal Control' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CommsLink — Talk to AI. Control Your Machines.',
    description: 'Voice-powered AI agents that execute commands on your remote servers.',
    images: ['/og-image.png'],
  },
  keywords: ['AI agents', 'voice control', 'remote terminal', 'server management', 'AI chat', 'terminal automation', 'DevOps AI'],
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
