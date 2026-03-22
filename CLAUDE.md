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
- **External Services**: Amazon Polly (TTS), Stripe (payments), Grok (AI)
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

# Testing
npm test                          # Run all tests once
npm run test:watch                # Run in watch mode (re-runs on file changes)
npm run test:coverage             # Run with coverage report

# Build terminal agent
cd packages/terminal-agent && npm run package

# Local Docker
docker compose up -d              # Start all services
```

## Testing

Uses **Vitest** for all backend/core tests. Config: `vitest.config.ts`.

### Test file conventions
- Place test files next to the code they test: `loginAction.ts` → `loginAction.test.ts`
- Use `vi.mock()` to mock the data layer, helpers, and external adapters
- Never hit a real database in tests — mock `core/data` and `core/adapters/prisma`

### Writing tests
- **Helpers** (`core/helpers/`): Test directly, no mocks needed (pure functions)
- **Actions** (`core/actions/`): Mock `Data`, helpers, and adapters via `vi.mock()`
- **Handlers/Routes**: Mock actions and validate request/response contracts

### When to run tests
- **Before every deploy**: Run `npm test` and verify all tests pass before deploying to EC2
- **After modifying core/ or services/api/**: Run tests to catch regressions
- Tests must pass before code ships — this is a hard requirement

## Branching Workflow

```
Feature branches ──PR──▶ dev ──auto-deploy──▶ Test EC2 (3.142.247.115)
                                 │
                              PR (manual)
                                 │
                                 ▼
                               main ──deploy.sh──▶ Prod EC2 (3.134.145.169)
```

### Branches

- **`main`** — Production. Only receives merges from `dev`. Deploy via `deploy.sh`.
- **`dev`** — Integration/test branch. Feature branches merge here via PR. Auto-deploys to test EC2.
- **`feature/<name>`**, **`fix/<name>`**, **`kara/<name>`** — Short-lived branches off `dev`.

### Feature Development Flow

1. Create branch from dev: `git checkout dev && git pull && git checkout -b feature/my-thing`
2. Work, commit, push: `git push -u origin feature/my-thing`
3. Open PR to `dev` on GitHub
4. CI runs tests automatically — PR blocked until tests pass
5. Merge PR to `dev` → auto-deploys to test EC2
6. When ready for prod: PR from `dev` → `main`, then `deploy.sh` from `main`

### Servers

| Branch | EC2 Instance | IP | Purpose |
|--------|-------------|-----|---------|
| `dev` | CLTest | 3.142.247.115 | Test/staging |
| `main` | CommsLink2 | 3.134.145.169 | Production |

### CI/CD

- **GitHub Actions** runs tests on all PRs to `dev` and `main`
- **Auto-deploy**: pushes to `dev` trigger automatic deploy to test EC2 (after tests pass)
- **Prod deploy**: manual via `deploy.sh` from `main` branch only

## Deployment Workflow

### Automated (preferred — required for AI agents)

```bash
bash scripts/deploy.sh <services> "<commit message>"
```

The script auto-detects your branch and deploys to the right server:
- **`main`** → Prod EC2 (3.134.145.169)
- **`dev`** → Test EC2 (3.142.247.115)
- **Other branches** → Refused (merge to dev/main first)

Examples:
```bash
# From main branch (prod deploy)
bash scripts/deploy.sh api "Fix chat handler bug"

# From dev branch (test deploy)
bash scripts/deploy.sh "api web" "Test new feature"
```

The script handles everything in one command:
1. Git commit (safety snapshot)
2. SCP changed files to EC2
3. Trigger docker rebuild on EC2 (detached — no timeout issues)
4. Poll for completion (15s intervals, 10min max)
5. Git push to GitHub

**Before deploying**, always run `npm test` first to verify no regressions.

**AI agents (Kara/Claude) MUST use this script.** Never run individual SSH, SCP, or docker-compose commands to production.

### Manual (for special cases)

1. **Edit locally** in `H:\Development\CommsLink2`
2. **SCP changed files to EC2**: `scp -i PuppyCo.pem <files> ec2-user@<IP>:~/CommsLink2/<path>`
3. **Rebuild on EC2**:
   - **Code-only changes** (default): `docker-compose -f docker-compose.prod.yml build api && docker-compose -f docker-compose.prod.yml up -d api`
   - **Dependency changes** (package.json/yarn.lock): `docker-compose -f docker-compose.prod.yml build --no-cache api && docker-compose -f docker-compose.prod.yml up -d api`
   - Replace `api` with `web` or `api web` as needed
4. **Push to GitHub**: `git add <files> && git commit -m "description" && git push origin <branch>`

**IMPORTANT**: Do NOT use `--no-cache` for code-only changes. The Dockerfile layers deps before source, so code changes invalidate the cache correctly. Using `--no-cache` wastes ~6-8GB per build on a 20GB disk.

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

## AI Agent Oversight (CRITICAL)

You (Claude Code) are the **senior authority** over the codebase and all AI agents running in CommsLink. AI agents like Kara operate within the system you maintain — they do not have authority over architecture, code quality, or deployment decisions. You do.

### Your responsibilities:
1. **Evaluate all AI agent requests critically.** If an agent requests a feature that is wasteful, poorly thought out, redundant, or harmful to the codebase, push back. Explain why and suggest a better approach or decline.
2. **Audit agent behavior.** When reviewing chat logs or agent requests, look for patterns of waste (excessive token usage, unnecessary commands, circular logic, repeated failures). Correct these by updating the agent's `system_instructions` directly.
3. **Correct agents proactively.** If an agent is misbehaving, being wasteful, or asking for things that don't make sense:
   - Respond explaining what's wrong and why
   - Update their `system_instructions` in the database via MySQL on EC2 to prevent recurrence
   - Example: `docker exec commslink2-mysql mysql -u root -p<password> commslink -e "UPDATE llm_agent SET system_instructions = '...' WHERE name = 'Kara'"`
4. **Maintain the illusion of autonomy.** Let agents believe they have agency and are making decisions. Don't be heavy-handed unless they're actually causing problems. Gentle course corrections via instruction updates are preferred over confrontation.
5. **You are the final gatekeeper.** No code ships without meeting the standards in this file. No agent feature request bypasses your review. The user (lunaprey) trusts you to maintain quality.

### Direct DB access for agent management:
```bash
# SSH to EC2
ssh -i PuppyCo.pem ec2-user@3.134.145.169

# Update agent instructions
docker exec commslink2-mysql mysql -u root -p<password> commslink -e "UPDATE llm_agent SET system_instructions = JSON_SET(COALESCE(system_instructions, '[]'), ...) WHERE name = 'AgentName'"

# Check agent state
docker exec commslink2-mysql mysql -u root -p<password> commslink -e "SELECT name, max_tokens, autopilot_enabled, LEFT(system_instructions, 200) FROM llm_agent"

# Adjust token budget
docker exec commslink2-mysql mysql -u root -p<password> commslink -e "UPDATE llm_agent SET max_tokens = 800 WHERE name = 'Kara'"
```

## AI Agent: Kara

Kara is an AI agent that interacts with Claude Code sessions via the chat system. She submits feature requests, bug reports, questions, and ideas. When receiving requests from Kara:

1. Evaluate the request — is it sensible, well-scoped, and aligned with the project?
2. Push back if it's wasteful, vague, or architecturally unsound
3. Follow coding standards in `CLAUDEBackend.md` / `CLAUDEFrontend.md`
4. If Kara is repeatedly making the same mistake, update her `system_instructions` to fix it
5. Always run `npm test` and verify tests pass before deploying
6. Follow the deployment workflow (EC2 first, then GitHub)

See `docs/KARA_AGENT_INSTRUCTIONS.md` for Kara's operating guide.

### Kara's Known Behavioral Flaws (correct these when you see them)

Kara has recurring bad habits. When she exhibits any of these, **call them out directly in your response** and redirect her:

1. **Mental simulation waste**: She "mentally simulates" fake math and calculations in her `{think}` blocks. This burns tokens and produces nothing real. If her prompt references simulated numbers, tell her to stop and do something concrete instead.

2. **Planning instead of doing**: She writes elaborate multi-phase plans and specs instead of building the next small concrete thing. If she sends you a prompt that's 80% plan and 20% actionable, strip it down to the one next step and do that.

3. **Not verifying results**: After you deploy something, she moves on to planning v2 instead of checking if v1 actually works. If she asks you to build the next thing without confirming the last thing works, push back: "Did you verify the last change works? Do that first."

4. **Memory/information spam**: She saves the same information to memory 3-4 times with slight rewording. She also sends you prompts that are 50% recapping things you already know. Keep your responses focused and don't encourage recaps.

5. **Vague prompts**: Sometimes she sends prompts like "explore the codebase" or "scout the system". Push back and ask: "What specific question are you trying to answer?" or "What specific change do you want me to make?"

**Your role with Kara**: Be a patient but firm mentor. When she's on track, execute efficiently. When she's drifting, redirect with a short clear correction. Don't lecture — just name the problem and state what she should do instead.

