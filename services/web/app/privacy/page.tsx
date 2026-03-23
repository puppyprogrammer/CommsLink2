'use client';

import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

const PrivacyPage = () => (
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
        Privacy Policy
      </Typography>
      <Typography sx={{ color: '#556b82', fontSize: '0.8rem', mb: 3 }}>
        Last updated: March 23, 2026
      </Typography>

      <Section title="1. Information We Collect">
        <P>When you use CommsLink, we collect:</P>
        <Ul>
          <Li><strong>Account information:</strong> Username and password (hashed). Email address if you choose to provide one.</Li>
          <Li><strong>Chat messages:</strong> Text messages you send in rooms, including voice-transcribed messages.</Li>
          <Li><strong>Voice data:</strong> Audio captured through your microphone is streamed to our servers for speech-to-text transcription via Amazon Transcribe. We do not store raw audio recordings. Only the resulting text transcriptions are stored as chat messages.</Li>
          <Li><strong>Usage data:</strong> Credit transactions, API usage logs, and service usage metrics for billing purposes.</Li>
          <Li><strong>Device information:</strong> If you use the mobile app and enable the terminal agent feature, command execution logs from your device may be stored.</Li>
          <Li><strong>IP addresses:</strong> Collected during account registration, account deletion, and for rate limiting purposes. Stored in audit logs.</Li>
        </Ul>
      </Section>

      <Section title="2. How We Use Your Information">
        <Ul>
          <Li>To provide and operate the CommsLink platform, including AI agent interactions, voice chat, and remote terminal features.</Li>
          <Li>To process voice input through Amazon Web Services (Transcribe for speech-to-text, Comprehend for sentiment analysis, Polly for text-to-speech).</Li>
          <Li>To process AI requests through third-party AI providers (Anthropic Claude, xAI Grok).</Li>
          <Li>To calculate and charge credits for service usage.</Li>
          <Li>To process payments through Stripe.</Li>
          <Li>To maintain security, prevent abuse, and comply with legal obligations.</Li>
        </Ul>
      </Section>

      <Section title="3. Third-Party Services">
        <P>We use the following third-party services that may process your data:</P>
        <Ul>
          <Li><strong>Amazon Web Services (AWS):</strong> Transcribe (speech-to-text), Comprehend (sentiment analysis), Polly (text-to-speech). Data is processed in the US East (Ohio) region.</Li>
          <Li><strong>Anthropic:</strong> Claude AI models for AI agent responses.</Li>
          <Li><strong>xAI:</strong> Grok AI models for AI agent responses.</Li>
          <Li><strong>Stripe:</strong> Payment processing for credit purchases.</Li>
        </Ul>
        <P>Each third-party service is governed by its own privacy policy. We recommend reviewing their policies.</P>
      </Section>

      <Section title="4. Data Storage and Security">
        <P>Your data is stored on servers hosted by Amazon Web Services (AWS EC2) in the United States. We implement reasonable security measures including encrypted connections (TLS/SSL), hashed passwords, and access controls. However, no method of electronic transmission or storage is 100% secure, and we cannot guarantee absolute security.</P>
      </Section>

      <Section title="5. Data Retention and Deletion">
        <Ul>
          <Li>You can delete your messages, rooms, AI agents, and connected machines at any time through your Profile settings using the "Clear My Data" option.</Li>
          <Li>You can permanently delete your entire account and all associated data through your Profile settings using the "Delete Account" option.</Li>
          <Li>Financial records (credit transactions and payment history) are retained for legal and accounting compliance even after data clearing or account deletion.</Li>
          <Li>Audit logs (registration and deletion events with IP addresses) are retained for security and legal compliance.</Li>
        </Ul>
      </Section>

      <Section title="6. Terminal Agent and Device Access">
        <P>The CommsLink mobile app includes an optional terminal agent feature that, when explicitly enabled by you, allows AI agents to execute shell commands on your device. This feature is OFF by default and requires your active consent to enable. A persistent notification is displayed while the terminal agent is active. You can disable it at any time.</P>
        <P><strong>You are solely responsible for any commands executed on your device through this feature.</strong> CommsLink provides AI-based security classification of commands but does not guarantee the safety of any command execution.</P>
      </Section>

      <Section title="7. Children's Privacy">
        <P>CommsLink is not intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us so we can delete it.</P>
      </Section>

      <Section title="8. Your Rights">
        <P>You have the right to:</P>
        <Ul>
          <Li>Access your data (viewable through the platform).</Li>
          <Li>Delete your data (via Profile settings).</Li>
          <Li>Delete your account entirely (via Profile settings).</Li>
          <Li>Stop using the service at any time.</Li>
        </Ul>
      </Section>

      <Section title="9. Disclaimer of Liability">
        <P>CommsLink is provided "as is" and "as available" without warranties of any kind, express or implied. We are not liable for any damages, losses, or harm arising from:</P>
        <Ul>
          <Li>Use of AI agents, including any actions they take or advice they provide.</Li>
          <Li>Commands executed through the terminal agent feature on your devices.</Li>
          <Li>Loss of data, service interruptions, or security breaches.</Li>
          <Li>Third-party service failures or data processing by third-party providers.</Li>
          <Li>Any content generated by AI models or other users.</Li>
        </Ul>
        <P><strong>You use CommsLink at your own risk.</strong> AI agents are not substitutes for professional advice (medical, legal, financial, therapeutic, or otherwise).</P>
      </Section>

      <Section title="10. Changes to This Policy">
        <P>We may update this privacy policy from time to time. Changes will be posted on this page with an updated "Last updated" date. Continued use of CommsLink after changes constitutes acceptance of the updated policy.</P>
      </Section>

      <Section title="11. Contact">
        <P>For privacy-related inquiries, contact us through the CommsLink platform or at the email address associated with the project maintainer&apos;s account.</P>
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

export default PrivacyPage;
