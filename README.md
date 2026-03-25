# CommsLink

**Voice AI technology for people and games.**

CommsLink is a real-time communication platform with voice-controlled AI agents, remote terminal execution, and game integrations. Built with TypeScript, deployed on AWS.

**Live at [commslink.net](https://commslink.net)**

## Products

### CommsLink Chat
Talk to autonomous AI agents that execute commands on your servers. Deploy agents, manage infrastructure, and collaborate through voice and text.

- Voice-powered AI chat with Grok and Claude models
- Remote terminal execution via PTY-based agents
- Real-time speech-to-text (Amazon Transcribe) and text-to-speech (Amazon Polly)
- Sentiment-aware voice synthesis with emotion detection (Amazon Comprehend)
- Credit-based usage system with Stripe payments

### FFXIVoices
A [Dalamud plugin](https://github.com/puppyprogrammer/CommsLink-Voices-for-FFXIV) that gives FFXIV characters AI voices. Chat messages are spoken aloud to nearby players with proximity-based audio.

- Amazon Polly (free) and ElevenLabs (donor) voices
- Proximity audio with inverse square volume falloff (50 yalm range)
- Party, Say, Shout/Yell, and Whisper chat support
- WSS/TLS secure WebSocket connections
- Plugin auto-updater

### ElevenVoiceReader
A [Chrome extension](https://chromewebstore.google.com/detail/elevenvoicereader/gnakoejcmfhfnoefgdjfpbmlnjpggbkn) that reads any webpage aloud using ElevenLabs AI voices.

## Architecture

```
core/                     # Shared library
  actions/                # Business logic
  data/                   # Database layer (Prisma/MySQL)
  adapters/               # External services (Polly, Transcribe, Comprehend, ElevenLabs, Stripe, Claude, Grok)
  helpers/                # Utilities

services/
  api/                    # Hapi.js API + Socket.IO + WebSocket server
  web/                    # Next.js 14 frontend (App Router)

packages/
  terminal-agent/         # Standalone CLI agent for remote command execution
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Hapi.js, Socket.IO, TypeScript |
| Frontend | Next.js 14 (App Router), React 18, MUI |
| Database | MySQL 8.0, Prisma ORM |
| AI | Grok (xAI), Claude (Anthropic) |
| Voice | Amazon Polly (TTS), Transcribe (STT), Comprehend (sentiment), ElevenLabs |
| Payments | Stripe |
| Infrastructure | Docker Compose, AWS EC2, nginx, Let's Encrypt |

## Development

```bash
# Install
npm install
cd services/web && yarn install

# Database
npx prisma migrate dev
npx prisma generate

# Run tests
npm test

# Local Docker
docker compose up -d
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```
DATABASE_URL=mysql://root:password@localhost:3306/commslink
JWT_SECRET=<secret>
SESSION_SECRET=<32+ char secret>
ELEVENLABS_API_KEY=sk_...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### Testing

Uses Vitest. Tests live next to the code they test (e.g., `loginAction.test.ts`).

```bash
npm test              # Run once
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## Deployment

Branches auto-deploy:
- `main` -> Production
- `dev` -> Test/staging

```bash
bash scripts/deploy.sh api "Fix description here"
bash scripts/deploy.sh "api web" "Deploy both services"
```

## License

Proprietary. All rights reserved.
