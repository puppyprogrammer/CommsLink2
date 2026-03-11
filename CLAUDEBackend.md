# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript monorepo using Yarn workspaces to manage multiple packages:

- **core/** - Core shared library (`@commslink/core`)
- **services/** - Individual microservices (APIs and background services)
- **jobs/** - Scheduled background jobs for data processing and maintenance

**Technology Stack:**

- Framework: Hapi.js (v21)
- Database: MySQL 8.0 with Prisma ORM (v5)
- Language: TypeScript (Node 18.20.8 required)
- Message Queue: RabbitMQ
- Cache: Redis
- Monitoring: DataDog APM

## Development Commands

### Essential Commands

```bash
# Install dependencies (from root)
yarn install

# Linting
yarn lint
yarn lint:fix

# Database operations
npx prisma migrate dev          # Apply pending migrations
npx prisma migrate create       # Create new migration
npx prisma db push              # Push schema without migration
npx prisma generate             # Regenerate Prisma client

# Start individual services (from service directory)
cd services/api
yarn start   # Start service
yarn watch   # Start with hot reload
```

### Infrastructure

```bash
# Start local development environment
docker compose up -d

# Services exposed:
# - MySQL: localhost:3306
# - RabbitMQ: localhost:5672 (Management UI: localhost:15672)
# - Redis: localhost:6379
# - DataDog Agent: localhost:8126 (APM)
```

## Architecture

### Three-Layer Architecture Pattern

The codebase follows a strict separation of concerns:

1. **Controllers** (services/\*/src/controllers/)
   - Handle HTTP requests/responses
   - Validate input with Joi schemas
   - Invoke actions and return formatted responses
   - Located in each service directory

2. **Actions** (core/actions/)
   - Business logic layer (shared across services)
   - Perform specific tasks (CRUD operations, complex workflows)
   - May call multiple Data layer functions
   - Should be pure functions focused on single responsibility
   - Often traced with DataDog (`tracer.trace('ACTION.NAME', ...)`)

3. **Data** (core/data/)
   - Database access layer (shared across services)
   - Direct Prisma client interactions only
   - Each model has its own directory with CRUD operations
   - Example: `core/data/user/index.ts` contains all user queries

**Rule: Controllers -> Actions -> Data. Actions should never directly use Prisma - always go through Data layer.**

### Monorepo Structure

```
core/                        # Core shared library (@commslink/core)
├── actions/                 # Business logic (shared)
├── data/                    # Database access layer (shared)
├── adapters/                # External service integrations (AWS S3, etc.)
├── helpers/                 # Utility functions
├── interfaces/              # TypeScript type definitions
├── workflows/               # Complex multi-step processes
├── lib/                     # Framework integrations (Hapi plugins, auth)
└── constants/               # Application constants

services/                    # Microservices
├── api/                     # Primary API service
├── web-socket/              # Real-time communication service
├── notifications/           # Push/SMS/email notification service
├── monitoring/              # System monitoring service
└── heartbeats/              # Service health checking

jobs/                        # Background jobs
├── data-aggregator/         # Aggregate data
├── process-scheduler-tasks/ # Execute scheduled tasks
└── ...

prisma/                      # Database
├── schema.prisma            # Database schema definition
└── migrations/              # Version-controlled migrations
```

### Path Aliases (tsconfig.json)

The codebase uses TypeScript path aliases for cleaner imports:

- `#data` -> `core/data`
- `#hapi/*` -> `core/lib/hapi/*`
- `#prisma/*` -> `prisma/*`
- `@commslink/core` -> core package

Example usage:

```typescript
import Data from '#data';
import { user as User } from '#prisma/client';
import sanitizeUser from '@commslink/core/actions/user/sanitizeUser';
```

### Services Architecture

Each service follows this structure:

```
services/my-service/
├── src/
│   ├── index.ts          # Service entry point
│   ├── server.ts         # Hapi server configuration
│   ├── controllers/      # Request handlers (specific to this service)
│   ├── routes/           # Route definitions (usually versioned: v1/, v2/)
│   └── legacy/           # Deprecated routes/controllers
├── package.json
└── docker-compose.yml    # Service-specific Docker config
```

## Coding Standards

**IMPORTANT:** This project follows strict coding standards. All code contributions must adhere to the patterns and practices below.

### Key Requirements for AI Assistants

When generating or modifying code, you MUST follow these standards:

#### 1. Import Ordering (Strict)

```typescript
// Node modules
// Actions
// Adapters
// Data modules
// Prisma models
// Types
// SCSS
```

#### 2. JSDoc Format

```typescript
/**
 * Description ending with period.
 *
 * @param context - Aligned dash, no {type}.
 * @param userId  - Concise description.
 * @returns Meaningful description only.
 */
```

#### 3. Controller Structure

```typescript
tracer.trace('CONTROLLER.MODULE.ACTION', async () => {
  // ┌──────────────────────────────────────────┐
  // │ Validation                               │
  // └──────────────────────────────────────────┘
  // ┌──────────────────────────────────────────┐
  // │ Business Logic                           │
  // └──────────────────────────────────────────┘
});
```

#### 4. Data Layer Pattern

```typescript
// Validator
const schema = Joi.object({ ... });

// Types
interface DTO { ... }

// Create / Update
const create = async (data: DTO) => { ... };

// Read
const findById = async (id: string) => { ... };

// Export
export default { create, findById, ... };
```

#### 5. Strong Typing

- No `any` types
- Explicit types for all parameters and returns
- TypeScript strict mode
- No implicit any

#### 6. Code Style

- Production-ready code only
- Avoid unnecessary abstractions
- Prefer native ES features over lodash
- Use `Set` for uniqueness
- Explicit over implicit

#### 7. Prettier / ESLint (CRITICAL)

- **Prettier is enforced via ESLint.** Every file you write or edit MUST pass `prettier/prettier` rules.
- Key rules to watch:
  - **Line length:** Break long JSX props onto separate lines (one prop per line when the tag exceeds ~100 chars).
  - **Trailing commas:** Multi-line function arguments, arrays, and object literals need trailing commas.
  - **Multi-line expressions:** Long `.sort()`, `.map()`, `.filter()` callbacks should be broken across lines with proper indentation.
- **After writing or editing any file, mentally verify formatting.** If in doubt, keep lines short and break JSX props onto separate lines.

#### 8. Domain Rules

- Data correctness > cleverness
- Auditability required
- No silent failures

### What NOT to Do

- Remove useful comments during refactors
- Over-explain basics
- Rewrite code structure unnecessarily
- Break formatting alignment
- Leak Prisma types across boundaries
- Use verbose JSDoc

### What to Do

- Follow import order strictly
- Use tracer.trace for all controllers/actions
- Keep comments concise and meaningful
- Maintain box drawing section dividers
- Use Boom for HTTP errors
- Remove nulls/undefined early
- Export custom types, not Prisma types

## Testing

No test framework is currently configured. There is no `yarn test` script, and no test runner (Jest, Vitest, etc.) is installed.

**Verification** relies on TypeScript compilation:

```bash
npx tsc --noEmit --project tsconfig.json
```

## Working with Prisma

### Database Schema

The Prisma schema (`prisma/schema.prisma`) defines all database models. Prisma Client is generated to `prisma/client/`.

**After schema changes, always:**

1. Create migration: `npx prisma migrate dev --name descriptive_name`
2. Regenerate client: `npx prisma generate` (happens automatically with migrate)

### Migration Workflow

1. Modify `prisma/schema.prisma`
2. Create migration: `npx prisma migrate dev --name add_user_field`
3. Review generated SQL in `prisma/migrations/`
4. Commit both schema changes and migration files

**Important:** Migrations are version-controlled and applied in production. Never manually modify the database.

## Common Patterns

### DataDog Tracing

Actions and controllers are wrapped with DataDog tracing:

```typescript
import tracer from 'dd-trace';

const myAction = async (param: string) =>
  tracer.trace('ACTION.MODULE.MY_ACTION', async () => {
    // Action logic
  });
```

### Error Handling

Use Hapi Boom for HTTP errors in controllers:

```typescript
import Boom from '@hapi/boom';

if (!found) {
  throw Boom.notFound('Resource not found');
}
```

**CRITICAL: The `fail()` helper returns HTTP 200 for errors.**

Legacy routes use `.catch((error) => fail(error))` which converts errors into plain objects. Hapi serves these as **HTTP 200** — the `statusCode` field in the payload does NOT set the actual HTTP status. This means:

- Throwing `new Error()` or `Boom.xxx()` in a controller -> `fail()` catches it -> returns HTTP 200 with error-shaped payload
- Axios on the frontend sees 200 -> does not throw -> catch blocks are never reached
- Frontend API routes that only handle known success results will **stall** (no response sent)

**To return actual HTTP error status codes from legacy controllers:**
```typescript
// WRONG — fail() flattens this to HTTP 200:
throw Boom.badRequest('Invalid input');
throw new Error('Something failed');

// CORRECT — returns actual HTTP 400:
return h.response({ result: 'ERROR_CODE', message: 'User-facing message' }).code(400);
```

**Frontend API routes MUST always have an else clause:**
```typescript
const response = await authApi.someCall(payload);
if (response.data.result === 'SUCCESS') {
  res.status(200).json({...});
} else {
  // Backend returned 200 with error payload via fail()
  res.status(400).send({ errorMessage: 'Something went wrong.' });
}
```

For new controllers (non-legacy), use Boom normally — it works correctly when errors are thrown without being caught by `fail()`.

### Validation

Controllers use Joi for request validation:

```typescript
import Joi from 'joi';

const schema = Joi.object({
  userId: Joi.string().uuid().required(),
  accountId: Joi.string().uuid().required(),
});
```

### Data Access

Always access database through the Data layer, never directly:

```typescript
// Correct
import Data from '#data';
const users = await Data.user.findAllByIds(userIds);

// Incorrect
import prisma from '@commslink/core/adapters/prisma';
const users = await prisma.user.findMany({ ... });
```

### Date Handling

Always use dayjs from the core wrapper (plugins pre-loaded):

```typescript
import dayjs from '@commslink/core/lib/dayjs';

const startOfMonth = dayjs().tz('America/Chicago').startOf('month');
```

**Never** import dayjs directly from the package - always use `@commslink/core/lib/dayjs`

## Important Notes

- **Node Version:** Must use Node 18.20.8 (specified in engines)
- **Workflows Directory:** Contains complex multi-step processes (notifications, PDF generation). These orchestrate multiple actions.
- **Legacy Code:** Services contain `legacy/` directories with deprecated code - prefer new patterns in controllers/routes
- **Legacy Route Error Handling:** All legacy routes use `.catch((error) => fail(error))` which returns HTTP 200 for errors. See Error Handling section above.
- **Auto-Routes:** Services use an auto-route loading plugin that discovers routes automatically
- **Authentication:** Hapi bearer token auth is configured via `@commslink/core/lib/hapi/auth`

## For AI Assistants

When working in this codebase:

1. Follow import ordering exactly
2. Use JSDoc formatting with aligned dashes
3. Wrap controllers/actions in tracer.trace
4. Use box drawing for section dividers
5. Keep comments concise and meaningful
6. Never remove useful comments
7. Production-ready code only
8. Strong typing everywhere
9. Data correctness is paramount

Remember: Code quality, data integrity, and auditability are critical.

## Enforcement Policy (CRITICAL)

**You MUST act as a guardian of this codebase's standards.** If the user requests code or changes that violate any principle in this document, you must:

1. **Stop before writing the violating code.** Do not silently comply.
2. **Clearly identify the violation.** Name the specific rule being broken and reference the relevant section of this document.
3. **Explain why it matters.** Give a brief, practical reason — not a lecture.
4. **Suggest the correct approach.** Show what the compliant version would look like.
5. **Ask for explicit confirmation** before proceeding with the non-compliant approach. Use language like: *"This violates [rule]. The standard approach is [X]. Want me to proceed with the compliant version, or do you want to override this rule?"*

### What triggers enforcement

- Using `any` types or missing type annotations
- Importing Prisma directly instead of going through the Data layer
- Skipping `tracer.trace` on controllers or actions
- Breaking import ordering
- Calling Actions from the Data layer or Prisma from Actions (violating the three-layer rule)
- Using `dayjs` directly instead of the core wrapper
- Missing Joi validation on controller inputs
- Silent error swallowing (empty catch blocks, missing error handling)
- Leaking Prisma types across layer boundaries
- Any other violation of the standards documented above

### User overrides

If the user explicitly acknowledges the violation and confirms they want to proceed anyway, comply — but add a brief `// NOTE: Deviates from [rule] per user request` comment at the point of deviation so it is visible in future reviews.

### Do not be passive

This is not optional guidance. These are the rules of this codebase. A polite pushback that keeps the codebase clean is always preferable to silent compliance that introduces tech debt. The user has opted into this enforcement — respect that by holding the line.
