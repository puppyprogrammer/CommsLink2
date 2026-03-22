import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CommsLink — Voice-Controlled AI Agents for Remote Terminals',
  description: 'Talk to AI agents that execute commands on your servers. Voice-powered terminal control, autonomous agents, and real-time collaboration. Free to start.',
  openGraph: {
    title: 'CommsLink — Talk to AI. Control Your Machines.',
    description: 'Voice-powered AI agents that execute commands on your remote servers. Deploy autonomous agents, manage infrastructure, collaborate with your team.',
    url: 'https://commslink.net/landing',
  },
};

const LandingLayout = ({ children }: { children: React.ReactNode }) => children;

export default LandingLayout;
