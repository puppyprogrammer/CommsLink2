/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #050d1a 0%, #0a1929 50%, #0d2137 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: '#4dd8d0',
            marginBottom: 16,
            letterSpacing: '-1px',
          }}
        >
          CommsLink
        </div>
        <div
          style={{
            fontSize: 32,
            color: '#8ba4bd',
            fontWeight: 300,
            marginBottom: 40,
          }}
        >
          Talk to AI. Control your machines.
        </div>
        <div
          style={{
            display: 'flex',
            gap: 40,
            color: '#556b82',
            fontSize: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#4dd8d0' }}>&#9679;</span> Voice AI Agents
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#4dd8d0' }}>&#9679;</span> Remote Terminals
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#4dd8d0' }}>&#9679;</span> Real-Time Chat
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
