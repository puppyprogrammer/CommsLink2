'use client';

import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

const TermsPage = () => (
  <Box sx={{
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #050d1a 0%, #0a1929 40%, #0d2137 100%)',
    color: '#e0e8f0',
    py: 6,
    px: 2,
  }}>
    <Paper sx={{
      maxWidth: 700,
      mx: 'auto',
      p: { xs: 3, sm: 5 },
      bgcolor: 'rgba(13, 27, 42, 0.8)',
      border: '1px solid rgba(77, 216, 208, 0.1)',
      borderRadius: 3,
    }}>
      <Typography variant="h4" sx={{ color: '#4dd8d0', fontFamily: "'Orbitron', monospace", mb: 3 }}>
        Terms of Service
      </Typography>
      <Typography sx={{ color: '#556b82', fontSize: '0.8rem', mb: 3 }}>
        Last updated: March 23, 2026
      </Typography>

      <Section title="1. Acceptance of Terms">
        <P>By creating an account or using CommsLink, you agree to these Terms of Service and our Privacy Policy. If you do not agree, do not use the service.</P>
      </Section>

      <Section title="2. Description of Service">
        <P>CommsLink is a real-time communication platform with AI-powered agents, voice chat, and remote terminal control. The service is provided as an experimental research project and may change, be interrupted, or be discontinued at any time without notice.</P>
      </Section>

      <Section title="3. Account Responsibilities">
        <Ul>
          <Li>You must be at least 13 years old to use CommsLink.</Li>
          <Li>You are responsible for maintaining the security of your account credentials.</Li>
          <Li>You are responsible for all activity that occurs under your account.</Li>
          <Li>You must not share your account with others or create multiple accounts to circumvent limits.</Li>
        </Ul>
      </Section>

      <Section title="4. Acceptable Use">
        <P>You agree NOT to use CommsLink to:</P>
        <Ul>
          <Li>Violate any applicable laws or regulations.</Li>
          <Li>Harass, abuse, threaten, or harm other users.</Li>
          <Li>Distribute malware, viruses, or malicious code.</Li>
          <Li>Attempt to gain unauthorized access to other users&apos; accounts, devices, or data.</Li>
          <Li>Use the terminal agent feature to execute commands on devices you do not own or have authorization to access.</Li>
          <Li>Use AI agents for illegal activities, generating illegal content, or circumventing safety measures.</Li>
          <Li>Abuse the credit system, payment system, or exploit bugs for financial gain.</Li>
          <Li>Overload the service with automated requests, bots, or denial-of-service attacks.</Li>
        </Ul>
      </Section>

      <Section title="5. AI Agents and Generated Content">
        <P>CommsLink provides access to AI models from multiple providers (Anthropic, xAI). You acknowledge that:</P>
        <Ul>
          <Li>AI-generated content may be inaccurate, misleading, or inappropriate.</Li>
          <Li>AI agents are not substitutes for professional advice — including medical, legal, financial, or therapeutic advice.</Li>
          <Li>You are responsible for how you use and act on AI-generated content.</Li>
          <Li>CommsLink does not endorse, verify, or guarantee any AI-generated output.</Li>
          <Li>Companion and therapeutic AI personas are for entertainment and general wellness only, not clinical services.</Li>
        </Ul>
      </Section>

      <Section title="6. Terminal Agent Feature">
        <P>The terminal agent feature allows AI agents to execute shell commands on your connected devices. By enabling this feature, you acknowledge and accept that:</P>
        <Ul>
          <Li>You are solely responsible for any commands executed on your devices.</Li>
          <Li>CommsLink provides AI-based security classification but does not guarantee the safety of any command.</Li>
          <Li>Enabling terminal access carries inherent risk, including potential data loss, system damage, or security compromise.</Li>
          <Li>You should only connect devices you own and are willing to expose to AI-controlled command execution.</Li>
          <Li>CommsLink is not liable for any damage, data loss, or security incidents resulting from terminal agent usage.</Li>
        </Ul>
      </Section>

      <Section title="7. Credits and Payments">
        <Ul>
          <Li>Credits are a virtual currency used to pay for AI API calls, voice synthesis, and other premium features.</Li>
          <Li>Credit purchases are processed through Stripe and are non-refundable except as required by law.</Li>
          <Li>Credit prices and consumption rates may change at any time.</Li>
          <Li>Free credits provided at registration are promotional and may be adjusted or discontinued.</Li>
          <Li>Unused credits do not expire but are forfeited upon account deletion.</Li>
        </Ul>
      </Section>

      <Section title="8. Intellectual Property">
        <Ul>
          <Li>Content you create (messages, AI agent configurations, room settings) remains yours.</Li>
          <Li>AI-generated content is provided without ownership claims by CommsLink.</Li>
          <Li>The CommsLink platform, code, and branding are the property of CommsLink and its creators.</Li>
          <Li>You grant CommsLink a license to store, process, and transmit your content as necessary to provide the service.</Li>
        </Ul>
      </Section>

      <Section title="9. Termination">
        <P>We may suspend or terminate your account at any time, with or without cause, including for violations of these terms. You may delete your account at any time through your Profile settings. Upon termination, your right to use the service ceases immediately.</P>
      </Section>

      <Section title="10. Disclaimer of Warranties">
        <P><strong>CommsLink is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without warranties of any kind, whether express, implied, or statutory.</strong> We disclaim all warranties including, but not limited to, implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the service will be uninterrupted, secure, or error-free.</P>
      </Section>

      <Section title="11. Limitation of Liability">
        <P><strong>To the maximum extent permitted by law, CommsLink and its creators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, use, or goodwill, arising from your use of the service.</strong></P>
        <P>Our total liability for any claim arising from these terms or the service shall not exceed the amount you paid to CommsLink in the 12 months preceding the claim, or $50, whichever is greater.</P>
      </Section>

      <Section title="12. Indemnification">
        <P>You agree to indemnify, defend, and hold harmless CommsLink and its creators from any claims, damages, losses, or expenses arising from your use of the service, your violation of these terms, or your violation of any rights of another party.</P>
      </Section>

      <Section title="13. Changes to Terms">
        <P>We may update these terms at any time. Changes will be posted on this page. Continued use of CommsLink after changes constitutes acceptance of the updated terms.</P>
      </Section>

      <Section title="14. Governing Law">
        <P>These terms are governed by the laws of the United States. Any disputes arising from these terms or the service shall be resolved in the courts of the state in which CommsLink operates.</P>
      </Section>

      <Section title="15. Contact">
        <P>For questions about these terms, contact us through the CommsLink platform.</P>
      </Section>
    </Paper>
  </Box>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box sx={{ mb: 3 }}>
    <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: '#4dd8d0', mb: 1 }}>{title}</Typography>
    {children}
  </Box>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <Typography sx={{ fontSize: '0.85rem', color: '#8ba4bd', lineHeight: 1.7, mb: 1 }}>{children}</Typography>
);

const Ul = ({ children }: { children: React.ReactNode }) => (
  <Box component="ul" sx={{ pl: 2.5, my: 1 }}>{children}</Box>
);

const Li = ({ children }: { children: React.ReactNode }) => (
  <Box component="li" sx={{ fontSize: '0.85rem', color: '#8ba4bd', lineHeight: 1.7, mb: 0.5 }}>{children}</Box>
);

export default TermsPage;
