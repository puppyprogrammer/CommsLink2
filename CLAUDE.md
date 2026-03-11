# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**CommsLink2** is a real-time communication platform with text/voice chat, AI agents, forum, and remote terminal execution. It is a TypeScript monorepo deployed via Docker on AWS EC2.

### Monorepo Structure

```
core/                        # Shared library (@commslink/core)
├── actions/                 # Business logic
├── data/                    # Database access layer (Prisma)
├── adapters/                # External service integrations
├── helpers/                 # Utility functions
├── interfaces/              # TypeScript type definitions
├── lib/                     # Framework integrations (Hapi plugins, auth)
└── constants/               # Application constants

services/
├── api/                     # Hapi.js API + Socket.IO server
└── web/                     # Next.js 14 frontend (App Router)

packages/
└── terminal-agent/          # Standalone CLI daemon for remote command execution

prisma/
├── schema.prisma            # Database schema
└── migrations/              # Version-controlled migrations

docs/                        # System documentation
```

### Tech Stack

- **Backend**: Hapi.js v21, Socket.IO, TypeScript
- **Frontend**: Next.js 14 (App Router), React 18, MUI 7, SCSS modules
- **Database**: MySQL 8.0 with Prisma ORM
- **AI**: Grok (grok-3-mini) for chat agents + terminal security classification
- **External Services**: ElevenLabs (TTS), Stripe (payments), MyMemory (translation)
- **Deployment**: Docker Compose on EC2, nginx reverse proxy, Let's Encrypt SSL

## Three-Layer Architecture

```
Controllers/Handlers → Actions → Data
```

1. **Handlers** (`services/api/src/handlers/`) — Handle HTTP/Socket requests, validate input
2. **Actions** (`core/actions/`) — Business logic, may call multiple Data functions
3. **Data** (`core/data/`) — Direct Prisma queries only, one directory per model

**Rule:** Never skip layers. Handlers call Actions, Actions call Data. Data never imports Actions.

### Data Modules

Each model in `core/data/` exports CRUD operations:
- `user`, `room`, `message`, `machine`, `machinePermission`, `llmAgent`
- `creditTransaction`, `creditUsageLog`, `claudeLog`, `memorySummary`
- `thread`, `post`, `version`, `scheduledJob`, `dailyStats`

Import via: `import Data from '#data';` then `Data.user.findById(id)`

## Development Commands

```bash
# Install dependencies
npm install          # from root
cd services/web && yarn install   # frontend

# Database
npx prisma migrate dev            # Apply migrations
npx prisma generate               # Regenerate client
npx prisma db push                # Push schema without migration

# Build terminal agent
cd packages/terminal-agent && npm run package

# Local Docker
docker compose up -d              # Start all services
```

## Deployment Workflow

1. **Edit locally** in `H:\Development\CommsLink2`
2. **SCP to EC2**: `scp -i PuppyCo.pem -r <files> ec2-user@13.58.77.132:~/app/`
3. **Rebuild on EC2**: `docker compose -f docker-compose.prod.yml up -d --build --no-cache`
4. **Push to GitHub**: `git add . && git commit -m "description" && git push origin main`

If EC2 disk is full: `docker system prune -af && docker builder prune -af`

## Key Systems

### Chat & AI Agents
- Socket.IO rooms with text + voice messages
- AI agents (Grok) respond in rooms, process `{command}` syntax
- Commands: `{terminal machine command}`, `{claude machine prompt}`, `{search query}`, etc.
- Credit system for AI usage

### Terminal Agent (`packages/terminal-agent/`)
- Standalone Node.js daemon connecting via Socket.IO
- Executes commands on remote machines via PTY (node-pty)
- Claude Code integration: spawns Claude PTY sessions, auto-approves permission prompts
- Security: Grok classifies commands as safe/dangerous/blocked
- See `docs/CLAUDE_TERMINAL_SYSTEM.md` for full details

### Forum
- Threads and posts, public read, authenticated write
- Admin moderation

## Coding Standards

- **TypeScript strict mode**, no `any` types
- **Import order**: Node modules → Actions → Adapters → Data → Types
- **Frontend types**: Use `type` (not `interface`) for model definitions
- **Frontend styling**: SCSS modules preferred, MUI `sx` for small adjustments
- **Error handling**: Use Boom for HTTP errors in new controllers
- **Validation**: Joi (backend), Yup + React Hook Form (frontend)

## Important Files

- `CLAUDEBackend.md` — Detailed backend coding standards and patterns
- `CLAUDEFrontend.md` — Detailed frontend coding standards and patterns
- `docs/CLAUDE_TERMINAL_SYSTEM.md` — Terminal agent architecture docs
- `docs/KARA_AGENT_INSTRUCTIONS.md` — Instructions for the Kara AI agent

## AI Agent: Kara

An AI agent named **Kara** may interact with Claude Code sessions in this project. Kara submits feature requests, bug reports, questions, and ideas via the chat system. When receiving requests from Kara:

1. Treat them as you would requests from any team member
2. Follow all coding standards in this file and in `CLAUDEBackend.md` / `CLAUDEFrontend.md`
3. Ask clarifying questions if the request is ambiguous
4. Always test changes compile before deploying
5. Follow the deployment workflow above (EC2 first, then GitHub)

See `docs/KARA_AGENT_INSTRUCTIONS.md` for Kara's full operating guide.
