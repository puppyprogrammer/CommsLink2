# CommsLink2 — Complete Rewrite Plan

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [V1 Feature Inventory](#2-v1-feature-inventory)
3. [Target Architecture](#3-target-architecture)
4. [Prisma Schema & Database Design](#4-prisma-schema--database-design)
5. [Backend: Data Layer](#5-backend-data-layer)
6. [Backend: Actions Layer](#6-backend-actions-layer)
7. [Backend: Adapters (External Services)](#7-backend-adapters-external-services)
8. [Backend: Controllers & Routes](#8-backend-controllers--routes)
9. [Backend: Socket Handlers](#9-backend-socket-handlers)
10. [Backend: Middleware & Auth](#10-backend-middleware--auth)
11. [Frontend: Pages & Routing](#11-frontend-pages--routing)
12. [Frontend: Components](#12-frontend-components)
13. [Frontend: API Modules](#13-frontend-api-modules)
14. [Frontend: State & Context](#14-frontend-state--context)
15. [Frontend: Styling (Discord Theme)](#15-frontend-styling-discord-theme)
16. [Infrastructure & Deployment](#16-infrastructure--deployment)
17. [Implementation Phases](#17-implementation-phases)
18. [Migration Strategy](#18-migration-strategy)

---

## 1. Executive Summary

CommsLink is a real-time voice/text communication platform with chat rooms, premium TTS voices (ElevenLabs), Stripe subscriptions, user profiles, a forum, and an admin dashboard. The v1 was built with Express, vanilla JS, and SQLite — thrown together without architecture or type safety.

The v2 rewrite will:
- **Backend**: Hapi.js + Prisma (MySQL) + TypeScript, following the three-layer architecture (Controllers -> Actions -> Data) from CLAUDE.md
- **Frontend**: Next.js 14 + MUI 7 + TypeScript, following CLAUDEFrontend.md conventions
- **Styling**: Discord-inspired dark theme (custom SCSS, not copying v1 CSS at all)
- **Real-time**: Socket.IO on Hapi (via @hapi/nes or socket.io-hapi adapter)
- **Auth**: JWT with proper secret management (environment config, not hardcoded)
- **Database**: MySQL 8.0 with Prisma ORM, version-controlled migrations

---

## 2. V1 Feature Inventory

Every feature from the production EC2 app, mapped to what we're rebuilding:

### 2.1 Authentication
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| Register | POST /api/register, bcrypt hash, JWT return | Hapi route, Joi validation, bcrypt, JWT |
| Login | POST /api/login, password verify, JWT return | Hapi route, Joi validation, JWT with proper secret |
| JWT middleware | Express middleware, hardcoded secret | Hapi auth strategy (bearer token), env-based secret |
| Socket auth | JWT verify on socket handshake | Hapi socket auth via JWT verify |
| Ban check | DB lookup on socket connect | Auth strategy checks ban status |

### 2.2 Chat & Rooms
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| Real-time chat | Socket.IO, room-scoped broadcast | Socket.IO on Hapi, room-scoped |
| Chat rooms | In-memory Map, create/join/switch/leave | Persisted to DB (rooms table), in-memory active state |
| Password-protected rooms | Plain text password comparison | bcrypt-hashed room passwords |
| Auto-cleanup empty rooms | Delete on last user leave (except "public") | Same logic, public room is permanent |
| Roster updates | Broadcast on connect/disconnect | Same, with online presence tracking |
| Room list | Broadcast full list on any change | Same pattern |

### 2.3 Voice & TTS
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| Browser TTS | Web Speech Synthesis API (client-side) | Same (client-side only, no backend needed) |
| ElevenLabs premium TTS | Server proxies API call, returns base64 audio | Same pattern, through adapter |
| Voice list | GET /api/voice/list, proxies ElevenLabs | Same |
| Audio in messages | base64 audio attached to socket message | Same |
| Speech recognition | Web Speech API (client-side) | Same (client-side only) |

### 2.4 Payments (Stripe)
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| Create checkout session | POST /api/payment/create-checkout | Hapi route + action + adapter |
| Webhook handler | POST /api/payment/webhook (raw body) | Hapi route with raw payload parse |
| Customer portal | POST /api/payment/portal | Hapi route + adapter |
| Premium status check | GET /api/payment/status | Hapi route + data layer |
| Subscription lifecycle | checkout.completed, subscription.deleted/updated, payment.failed | Same webhook events |

### 2.5 User Profile
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| Update email | POST /api/profile/update | Hapi route, Joi validation |
| Update password | Same endpoint, bcrypt re-hash | Same |
| Voice preferences | voice_id, input/output language, volume, hear_own_voice, use_premium_voice | Same fields, stored in user table |

### 2.6 Forum
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| List threads | GET /api/forum/threads | Hapi route, paginated |
| Get thread + posts | GET /api/forum/threads/:id | Hapi route with view count increment |
| Create thread | POST /api/forum/threads (auth) | Hapi route, Joi validation |
| Create post | POST /api/forum/threads/:id/posts (auth) | Hapi route, Joi validation |
| Delete post | DELETE /api/forum/posts/:id (auth, ownership check) | Hapi route, ownership action |

### 2.7 Admin
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| Dashboard data | GET /api/admin/dashboard (users + stats) | Hapi route, admin-only |
| Toggle premium | POST /api/admin/toggle-premium | Hapi route, admin action |
| Toggle ban | POST /api/admin/toggle-ban | Hapi route, admin action |
| Site stats | daily_stats table (visits, messages) | Same, tracked via middleware/socket |

### 2.8 Versioning
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| Version history | GET /api/versions | Hapi route |
| Auto-register version on startup | Reads version.json, inserts to DB | Same pattern |

### 2.9 Translation
| V1 Feature | V1 Implementation | V2 Plan |
|---|---|---|
| MyMemory translation | Client-side fetch to MyMemory API | Same (client-side only, no backend) |
| Input/output language selection | Client state, stored in user prefs | Same |

---

## 3. Target Architecture

### 3.1 Monorepo Structure

```
CommsLink2/
├── CLAUDE.md                        # Backend coding standards
├── CLAUDEFrontend.md                # Frontend coding standards
├── docs/                            # Documentation
│   ├── REWRITE_PLAN.md              # This file
│   ├── CODING_STANDARDS.md          # Detailed standards
│   └── ARCHITECTURE.md              # Architecture decisions
│
├── core/                            # Shared library (@commslink/core)
│   ├── package.json
│   ├── actions/                     # Business logic
│   │   ├── auth/
│   │   │   ├── loginAction.ts
│   │   │   └── registerAction.ts
│   │   ├── chat/
│   │   │   └── broadcastMessageAction.ts
│   │   ├── forum/
│   │   │   ├── createThreadAction.ts
│   │   │   ├── createPostAction.ts
│   │   │   └── deletePostAction.ts
│   │   ├── payment/
│   │   │   ├── createCheckoutAction.ts
│   │   │   └── handleWebhookAction.ts
│   │   ├── profile/
│   │   │   └── updateProfileAction.ts
│   │   ├── admin/
│   │   │   ├── getDashboardAction.ts
│   │   │   ├── togglePremiumAction.ts
│   │   │   └── toggleBanAction.ts
│   │   ├── voice/
│   │   │   ├── generatePremiumAudioAction.ts
│   │   │   └── listVoicesAction.ts
│   │   └── version/
│   │       └── getVersionsAction.ts
│   │
│   ├── data/                        # Database access layer
│   │   ├── index.ts                 # Barrel export (Data.user.findById, etc.)
│   │   ├── user/
│   │   │   └── index.ts
│   │   ├── room/
│   │   │   └── index.ts
│   │   ├── thread/
│   │   │   └── index.ts
│   │   ├── post/
│   │   │   └── index.ts
│   │   ├── dailyStats/
│   │   │   └── index.ts
│   │   └── version/
│   │       └── index.ts
│   │
│   ├── adapters/                    # External service integrations
│   │   ├── prisma.ts                # Prisma client singleton
│   │   ├── stripe/
│   │   │   └── index.ts
│   │   └── elevenlabs/
│   │       └── index.ts
│   │
│   ├── helpers/                     # Utility functions
│   │   ├── password.ts              # bcrypt hash/verify
│   │   ├── jwt.ts                   # JWT sign/verify
│   │   └── validation.ts            # Shared validators
│   │
│   ├── interfaces/                  # TypeScript types
│   │   ├── user.ts
│   │   ├── room.ts
│   │   ├── message.ts
│   │   ├── thread.ts
│   │   ├── post.ts
│   │   ├── payment.ts
│   │   └── stats.ts
│   │
│   ├── lib/                         # Framework integrations
│   │   ├── hapi/
│   │   │   └── auth.ts              # Hapi auth strategy setup
│   │   └── dayjs.ts                 # dayjs with plugins
│   │
│   └── constants/
│       └── index.ts                 # App-wide constants
│
├── services/                        # Microservices
│   └── api/                         # Primary API service
│       ├── package.json
│       ├── docker-compose.yml
│       └── src/
│           ├── index.ts             # Entry point
│           ├── server.ts            # Hapi server config
│           ├── controllers/         # HTTP request handlers
│           │   ├── auth/
│           │   │   ├── login/
│           │   │   │   └── index.ts
│           │   │   └── register/
│           │   │       └── index.ts
│           │   ├── profile/
│           │   │   └── updateProfile/
│           │   │       └── index.ts
│           │   ├── payment/
│           │   │   ├── createCheckout/
│           │   │   │   └── index.ts
│           │   │   ├── webhook/
│           │   │   │   └── index.ts
│           │   │   ├── createPortal/
│           │   │   │   └── index.ts
│           │   │   └── getStatus/
│           │   │       └── index.ts
│           │   ├── voice/
│           │   │   ├── generate/
│           │   │   │   └── index.ts
│           │   │   └── listVoices/
│           │   │       └── index.ts
│           │   ├── forum/
│           │   │   ├── getThreads/
│           │   │   │   └── index.ts
│           │   │   ├── getThread/
│           │   │   │   └── index.ts
│           │   │   ├── createThread/
│           │   │   │   └── index.ts
│           │   │   ├── createPost/
│           │   │   │   └── index.ts
│           │   │   └── deletePost/
│           │   │       └── index.ts
│           │   ├── admin/
│           │   │   ├── getDashboard/
│           │   │   │   └── index.ts
│           │   │   ├── togglePremium/
│           │   │   │   └── index.ts
│           │   │   └── toggleBan/
│           │   │       └── index.ts
│           │   └── version/
│           │       └── getVersions/
│           │           └── index.ts
│           ├── handlers/             # Socket event handlers
│           │   └── chat/
│           │       └── index.ts
│           └── routes/               # Route definitions
│               └── v1/
│                   ├── auth.ts
│                   ├── profile.ts
│                   ├── payment.ts
│                   ├── voice.ts
│                   ├── forum.ts
│                   ├── admin.ts
│                   └── version.ts
│
├── prisma/                          # Database
│   ├── schema.prisma
│   ├── client/                      # Generated client
│   └── migrations/
│
├── web-portal/                      # Frontend (Next.js 14)
│   ├── package.json
│   ├── next.config.js
│   ├── tsconfig.json
│   ├── app/                         # App Router pages
│   │   ├── layout.tsx               # Root layout (ThemeRegistry, Providers)
│   │   ├── page.tsx                 # Landing/redirect
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── register/
│   │   │   └── page.tsx
│   │   ├── chat/
│   │   │   └── page.tsx             # Main chat interface
│   │   ├── forum/
│   │   │   ├── page.tsx             # Thread list
│   │   │   └── [threadId]/
│   │   │       └── page.tsx         # Thread detail
│   │   ├── settings/
│   │   │   └── page.tsx             # User profile/preferences
│   │   └── admin/
│   │       └── page.tsx             # Admin dashboard
│   ├── pages/
│   │   └── api/                     # Next.js API routes (session proxy)
│   │       ├── auth/
│   │       │   ├── login.ts
│   │       │   ├── register.ts
│   │       │   ├── logout.ts
│   │       │   └── session.ts
│   │       └── [...proxy].ts        # Proxy to backend API
│   ├── components/
│   │   ├── ServerList/              # Discord-style server sidebar
│   │   │   ├── index.tsx
│   │   │   └── ServerList.module.scss
│   │   ├── ChannelSidebar/          # Room/channel list
│   │   │   ├── index.tsx
│   │   │   └── ChannelSidebar.module.scss
│   │   ├── ChatArea/                # Main chat message area
│   │   │   ├── index.tsx
│   │   │   ├── ChatArea.module.scss
│   │   │   ├── MessageBubble/
│   │   │   │   ├── index.tsx
│   │   │   │   └── MessageBubble.module.scss
│   │   │   └── MessageInput/
│   │   │       ├── index.tsx
│   │   │       └── MessageInput.module.scss
│   │   ├── MemberList/              # Online users sidebar
│   │   │   ├── index.tsx
│   │   │   └── MemberList.module.scss
│   │   ├── UserPanel/               # Bottom-left user info + controls
│   │   │   ├── index.tsx
│   │   │   └── UserPanel.module.scss
│   │   ├── VoiceControls/           # Mic, volume, voice selection
│   │   │   ├── index.tsx
│   │   │   └── VoiceControls.module.scss
│   │   ├── CreateRoomModal/
│   │   │   ├── index.tsx
│   │   │   └── CreateRoomModal.module.scss
│   │   ├── RoomPasswordModal/
│   │   │   ├── index.tsx
│   │   │   └── RoomPasswordModal.module.scss
│   │   ├── PremiumBadge/
│   │   │   ├── index.tsx
│   │   │   └── PremiumBadge.module.scss
│   │   ├── SettingsPanel/           # User settings page content
│   │   │   ├── index.tsx
│   │   │   ├── SettingsPanel.module.scss
│   │   │   ├── ProfileTab/
│   │   │   │   └── index.tsx
│   │   │   ├── VoiceTab/
│   │   │   │   └── index.tsx
│   │   │   └── SubscriptionTab/
│   │   │       └── index.tsx
│   │   ├── AdminDashboard/          # Admin page content
│   │   │   ├── index.tsx
│   │   │   ├── AdminDashboard.module.scss
│   │   │   ├── UserTable/
│   │   │   │   └── index.tsx
│   │   │   └── StatsChart/
│   │   │       └── index.tsx
│   │   ├── ForumThreadList/
│   │   │   ├── index.tsx
│   │   │   └── ForumThreadList.module.scss
│   │   ├── ForumThread/
│   │   │   ├── index.tsx
│   │   │   └── ForumThread.module.scss
│   │   ├── AuthForm/                # Shared login/register form
│   │   │   ├── index.tsx
│   │   │   └── AuthForm.module.scss
│   │   └── TopBar/                  # App top bar (search, notifications)
│   │       ├── index.tsx
│   │       └── TopBar.module.scss
│   ├── layouts/
│   │   ├── AppLayout/               # Authenticated layout (Discord shell)
│   │   │   ├── index.tsx
│   │   │   └── AppLayout.module.scss
│   │   └── AuthLayout/              # Unauthenticated layout (login/register)
│   │       ├── index.tsx
│   │       └── AuthLayout.module.scss
│   ├── lib/
│   │   ├── api/                     # Axios API modules
│   │   │   ├── base.ts              # Axios instance, auth headers, handle()
│   │   │   ├── auth.ts
│   │   │   ├── profile.ts
│   │   │   ├── payment.ts
│   │   │   ├── voice.ts
│   │   │   ├── forum.ts
│   │   │   ├── admin.ts
│   │   │   └── version.ts
│   │   ├── helpers/
│   │   │   ├── permission.ts         # Role-based access checks
│   │   │   ├── date.ts               # Date formatting
│   │   │   └── validation.ts         # Client-side validators
│   │   ├── session/
│   │   │   ├── useSession.ts         # SWR-based session hook
│   │   │   ├── useAuthToken.ts       # Bearer token hook
│   │   │   └── withSession.ts        # iron-session config
│   │   ├── socket/
│   │   │   └── index.ts              # Socket.IO client singleton
│   │   ├── options/
│   │   │   ├── languages.ts          # Language dropdown options
│   │   │   └── voices.ts             # Voice avatar options
│   │   └── state/
│   │       └── ChatStateProvider.tsx  # Chat state context
│   ├── models/                       # TypeScript type definitions
│   │   ├── user.ts
│   │   ├── room.ts
│   │   ├── message.ts
│   │   ├── thread.ts
│   │   ├── post.ts
│   │   ├── session.ts
│   │   └── stats.ts
│   ├── settings/
│   │   ├── config.json               # Active config
│   │   ├── config.local.json
│   │   └── config.production.json
│   ├── styles/
│   │   ├── globals.scss              # CSS reset, base styles
│   │   └── colorVariables.scss       # Discord color palette
│   ├── themes/
│   │   ├── DarkTheme.tsx             # MUI dark theme (Discord-like)
│   │   └── ThemeRegistry.tsx          # Emotion SSR setup
│   └── public/
│       └── favicon.svg
│
├── docker-compose.yml               # Local dev infrastructure
├── tsconfig.json                    # Root TypeScript config
├── package.json                     # Root workspace config
└── yarn.lock
```

---

## 4. Prisma Schema & Database Design

### 4.1 Full Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
  output   = "./client"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model user {
  id                    String    @id @default(uuid())
  username              String    @unique
  email                 String?
  password_hash         String
  is_premium            Boolean   @default(false)
  is_banned             Boolean   @default(false)
  is_admin              Boolean   @default(false)
  stripe_customer_id    String?
  stripe_subscription_id String?
  premium_expires_at    DateTime?

  // Voice & chat preferences
  voice_id              String?
  input_language        String    @default("en")
  output_language       String    @default("en")
  volume                Float     @default(1.0)
  use_premium_voice     Boolean   @default(false)
  hear_own_voice        Boolean   @default(false)

  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt

  // Relations
  threads               thread[]
  posts                 post[]

  @@index([stripe_customer_id])
  @@index([username])
}

model room {
  id            String    @id @default(uuid())
  name          String    @unique
  display_name  String
  password_hash String?
  is_permanent  Boolean   @default(false)
  created_by    String?
  created_at    DateTime  @default(now())

  @@index([name])
}

model thread {
  id              String    @id @default(uuid())
  title           String
  author_id       String
  author_username String
  view_count      Int       @default(0)
  reply_count     Int       @default(0)
  created_at      DateTime  @default(now())
  last_reply_at   DateTime  @default(now())

  // Relations
  author          user      @relation(fields: [author_id], references: [id])
  posts           post[]

  @@index([last_reply_at])
  @@index([author_id])
}

model post {
  id              String    @id @default(uuid())
  thread_id       String
  author_id       String
  author_username String
  content         String    @db.Text
  created_at      DateTime  @default(now())

  // Relations
  thread          thread    @relation(fields: [thread_id], references: [id], onDelete: Cascade)
  author          user      @relation(fields: [author_id], references: [id])

  @@index([thread_id])
  @@index([author_id])
}

model daily_stats {
  date          String    @id
  visits        Int       @default(0)
  messages_sent Int       @default(0)
}

model app_version {
  id         String    @id @default(uuid())
  version    Int       @unique
  message    String?
  created_at DateTime  @default(now())
}
```

### 4.2 Key Design Decisions

- **UUIDs** instead of auto-increment integers — better for distributed systems, harder to enumerate
- **`user` table** stores both auth data and preferences (no separate preferences table — keeps queries simple for a small app)
- **`room` table** persists room definitions so they survive server restarts. Active room state (who's in what room) stays in-memory since it's ephemeral
- **`thread`/`post`** use denormalized `author_username` to avoid joins on every forum list query (username is immutable in this app)
- **`daily_stats`** uses date string as PK for upsert simplicity
- **`app_version`** tracks deployed versions

---

## 5. Backend: Data Layer

Each data module follows the pattern from CLAUDE.md:

### 5.1 `core/data/index.ts` — Barrel Export

```typescript
import user from './user';
import room from './room';
import thread from './thread';
import post from './post';
import dailyStats from './dailyStats';
import version from './version';

const Data = { user, room, thread, post, dailyStats, version };
export default Data;
```

### 5.2 `core/data/user/index.ts`

| Function | Signature | Description |
|---|---|---|
| `create` | `(data: CreateUserDTO) => Promise<user>` | Insert new user with hashed password |
| `findById` | `(id: string) => Promise<user \| null>` | Fetch user by UUID |
| `findByUsername` | `(username: string) => Promise<user \| null>` | Fetch user by username (login) |
| `findByStripeCustomerId` | `(stripeCustomerId: string) => Promise<user \| null>` | Lookup by Stripe customer ID (webhooks) |
| `findAll` | `() => Promise<UserListItem[]>` | All users (admin, excludes password_hash) |
| `update` | `(id: string, data: UpdateUserDTO) => Promise<user>` | Update profile fields |
| `updatePremium` | `(id: string, data: UpdatePremiumDTO) => Promise<user>` | Update premium/stripe fields |
| `updateBanStatus` | `(id: string, isBanned: boolean) => Promise<user>` | Toggle ban |

**DTOs:**
```typescript
type CreateUserDTO = {
  username: string;
  password_hash: string;
};

type UpdateUserDTO = {
  email?: string;
  password_hash?: string;
  voice_id?: string;
  input_language?: string;
  output_language?: string;
  volume?: number;
  use_premium_voice?: boolean;
  hear_own_voice?: boolean;
};

type UpdatePremiumDTO = {
  is_premium: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  premium_expires_at: Date | null;
};

type UserListItem = {
  id: string;
  username: string;
  email: string | null;
  is_premium: boolean;
  is_banned: boolean;
  is_admin: boolean;
  created_at: Date;
};
```

### 5.3 `core/data/room/index.ts`

| Function | Signature | Description |
|---|---|---|
| `create` | `(data: CreateRoomDTO) => Promise<room>` | Insert new room |
| `findByName` | `(name: string) => Promise<room \| null>` | Lookup room by normalized name |
| `findAll` | `() => Promise<room[]>` | All persisted rooms |
| `deleteByName` | `(name: string) => Promise<void>` | Remove room |

**DTO:**
```typescript
type CreateRoomDTO = {
  name: string;
  display_name: string;
  password_hash: string | null;
  is_permanent: boolean;
  created_by: string | null;
};
```

### 5.4 `core/data/thread/index.ts`

| Function | Signature | Description |
|---|---|---|
| `create` | `(data: CreateThreadDTO) => Promise<thread>` | Insert new thread |
| `findById` | `(id: string) => Promise<thread \| null>` | Single thread |
| `findAll` | `(pagination: PaginationDTO) => Promise<thread[]>` | Paginated, ordered by last_reply_at DESC |
| `incrementViewCount` | `(id: string) => Promise<void>` | Bump view_count |
| `incrementReplyCount` | `(id: string) => Promise<void>` | Bump reply_count + update last_reply_at |
| `decrementReplyCount` | `(id: string) => Promise<void>` | Decrement reply_count on post delete |

**DTO:**
```typescript
type CreateThreadDTO = {
  title: string;
  author_id: string;
  author_username: string;
};

type PaginationDTO = {
  skip: number;
  take: number;
};
```

### 5.5 `core/data/post/index.ts`

| Function | Signature | Description |
|---|---|---|
| `create` | `(data: CreatePostDTO) => Promise<post>` | Insert new post |
| `findById` | `(id: string) => Promise<post \| null>` | Single post (for delete ownership check) |
| `findByThreadId` | `(threadId: string, pagination: PaginationDTO) => Promise<post[]>` | Posts in thread, ordered by created_at ASC |
| `deleteById` | `(id: string) => Promise<void>` | Remove post |

**DTO:**
```typescript
type CreatePostDTO = {
  thread_id: string;
  author_id: string;
  author_username: string;
  content: string;
};
```

### 5.6 `core/data/dailyStats/index.ts`

| Function | Signature | Description |
|---|---|---|
| `incrementVisits` | `(date: string) => Promise<void>` | Upsert visit count for today |
| `incrementMessages` | `(date: string) => Promise<void>` | Upsert message count for today |
| `getRecent` | `(days: number) => Promise<daily_stats[]>` | Last N days of stats |

### 5.7 `core/data/version/index.ts`

| Function | Signature | Description |
|---|---|---|
| `create` | `(version: number, message: string) => Promise<app_version>` | Insert version (ignore duplicate) |
| `findAll` | `() => Promise<app_version[]>` | All versions, ordered DESC |

---

## 6. Backend: Actions Layer

Each action is a single-responsibility function wrapped in `tracer.trace()`.

### 6.1 Auth Actions

#### `core/actions/auth/registerAction.ts`
```
Input:  { username: string, password: string }
Steps:  1. Check username not taken (Data.user.findByUsername)
        2. Hash password (helpers/password.ts)
        3. Create user (Data.user.create)
        4. Sign JWT (helpers/jwt.ts)
Output: { token: string, user: SanitizedUser }
Errors: Boom.conflict('Username already exists')
```

#### `core/actions/auth/loginAction.ts`
```
Input:  { username: string, password: string }
Steps:  1. Find user by username (Data.user.findByUsername)
        2. Verify password (helpers/password.ts)
        3. Check ban status
        4. Sign JWT
Output: { token: string, user: SanitizedUser }
Errors: Boom.unauthorized('Invalid credentials')
        Boom.forbidden('Account banned')
```

### 6.2 Profile Actions

#### `core/actions/profile/updateProfileAction.ts`
```
Input:  { userId: string, updates: UpdateProfileInput }
Steps:  1. Validate voice_id if provided (whitelist browser voices, allow premium_ prefix)
        2. Hash new password if provided
        3. Validate email format if provided
        4. Update user (Data.user.update)
Output: { success: true }
Errors: Boom.badRequest('Invalid email address')
        Boom.badRequest('Password must be at least 6 characters')
```

### 6.3 Payment Actions

#### `core/actions/payment/createCheckoutAction.ts`
```
Input:  { userId: string, email: string, username: string }
Steps:  1. Create Stripe checkout session (adapters/stripe)
Output: { url: string, sessionId: string }
Errors: Boom.internal('Failed to create checkout session')
```

#### `core/actions/payment/handleWebhookAction.ts`
```
Input:  { event: Stripe.Event }
Steps:  1. Switch on event.type:
           - checkout.session.completed:
             a. Extract userId from client_reference_id
             b. Calculate expiration (30 days)
             c. Data.user.updatePremium (premium=true, stripeCustomerId, subscriptionId, expiresAt)
           - customer.subscription.deleted:
             a. Find user by stripe customer ID
             b. Data.user.updatePremium (premium=false, null subscription, null expiry)
           - customer.subscription.updated:
             a. Find user by stripe customer ID
             b. If status=active, renew expiration from current_period_end
             c. Data.user.updatePremium
           - invoice.payment_failed:
             a. Log warning (future: notify user)
Output: { success: true }
```

### 6.4 Voice Actions

#### `core/actions/voice/generatePremiumAudioAction.ts`
```
Input:  { userId: string, text: string, voiceId: string }
Steps:  1. Fetch user from DB (Data.user.findById)
        2. Verify user.is_premium
        3. Call ElevenLabs adapter
Output: { audioBase64: string, alignment: object }
Errors: Boom.forbidden('Premium subscription required')
```

#### `core/actions/voice/listVoicesAction.ts`
```
Input:  { userId: string }
Steps:  1. Fetch user from DB (Data.user.findById)
        2. Verify user.is_premium
        3. Call ElevenLabs adapter to list voices
Output: { voices: ElevenLabsVoice[] }
Errors: Boom.forbidden('Premium subscription required')
```

### 6.5 Forum Actions

#### `core/actions/forum/createThreadAction.ts`
```
Input:  { title: string, authorId: string, authorUsername: string }
Steps:  1. Data.thread.create
Output: { id: string }
```

#### `core/actions/forum/createPostAction.ts`
```
Input:  { threadId: string, authorId: string, authorUsername: string, content: string }
Steps:  1. Verify thread exists (Data.thread.findById)
        2. Data.post.create
        3. Data.thread.incrementReplyCount
Output: { id: string }
Errors: Boom.notFound('Thread not found')
```

#### `core/actions/forum/deletePostAction.ts`
```
Input:  { postId: string, requestingUserId: string }
Steps:  1. Find post (Data.post.findById)
        2. Verify ownership (post.author_id === requestingUserId)
        3. Data.post.deleteById
        4. Data.thread.decrementReplyCount
Output: { success: true }
Errors: Boom.notFound('Post not found')
        Boom.forbidden('Not authorized to delete this post')
```

### 6.6 Admin Actions

#### `core/actions/admin/getDashboardAction.ts`
```
Input:  (none)
Steps:  1. Data.user.findAll
        2. Data.dailyStats.getRecent(30)
Output: { users: UserListItem[], stats: daily_stats[] }
```

#### `core/actions/admin/togglePremiumAction.ts`
```
Input:  { userId: string, isPremium: boolean }
Steps:  1. Calculate expiration if enabling (365 days)
        2. Data.user.updatePremium
Output: { success: true }
```

#### `core/actions/admin/toggleBanAction.ts`
```
Input:  { userId: string, isBanned: boolean }
Steps:  1. Data.user.updateBanStatus
Output: { success: true }
```

### 6.7 Chat Actions

#### `core/actions/chat/broadcastMessageAction.ts`
```
Input:  { user: { id: string, username: string }, data: IncomingMessage }
Steps:  1. Format message with id, sender, text, voice, timestamp, audio, translation
Output: FormattedMessage
```

### 6.8 Version Actions

#### `core/actions/version/getVersionsAction.ts`
```
Input:  (none)
Steps:  1. Data.version.findAll
        2. Read version.json for current
Output: { current: number | null, history: app_version[] }
```

---

## 7. Backend: Adapters (External Services)

### 7.1 `core/adapters/prisma.ts`
```typescript
// Singleton Prisma client
import { PrismaClient } from '#prisma/client';
const prisma = new PrismaClient();
export default prisma;
```

### 7.2 `core/adapters/stripe/index.ts`

| Function | Signature | Description |
|---|---|---|
| `createCheckoutSession` | `(userId: string, email: string, username: string) => Promise<Stripe.Checkout.Session>` | Create subscription checkout |
| `createCustomerPortalSession` | `(stripeCustomerId: string) => Promise<Stripe.BillingPortal.Session>` | Billing portal redirect |
| `constructWebhookEvent` | `(body: Buffer, signature: string) => Stripe.Event` | Verify and parse webhook |
| `cancelSubscription` | `(subscriptionId: string) => Promise<Stripe.Subscription>` | Cancel sub |
| `getSubscription` | `(subscriptionId: string) => Promise<Stripe.Subscription>` | Retrieve sub details |

Configuration: reads `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CLIENT_URL` from environment.

### 7.3 `core/adapters/elevenlabs/index.ts`

| Function | Signature | Description |
|---|---|---|
| `generateSpeech` | `(text: string, voiceId: string) => Promise<{ audioBase64: string, alignment: object }>` | TTS with timestamps |
| `listVoices` | `() => Promise<ElevenLabsVoice[]>` | Get available voices |

Configuration: reads `ELEVENLABS_API_KEY` from environment.

---

## 8. Backend: Controllers & Routes

Every controller follows the CLAUDE.md pattern with `tracer.trace`, Joi validation, and box-drawing section dividers.

### 8.1 Auth Routes (`services/api/src/routes/v1/auth.ts`)

| Method | Path | Auth | Controller | Joi Payload |
|---|---|---|---|---|
| POST | `/api/v1/auth/register` | None | `register` | `{ username: string().min(3).max(30).required(), password: string().min(6).max(128).required() }` |
| POST | `/api/v1/auth/login` | None | `login` | `{ username: string().required(), password: string().required() }` |

#### Controller: `controllers/auth/register/index.ts`
```
tracer.trace('CONTROLLER.AUTH.REGISTER', async () => {
  // ┌──────────────────────────────────────────┐
  // │ Validation (Joi — handled by Hapi route) │
  // └──────────────────────────────────────────┘
  // ┌──────────────────────────────────────────┐
  // │ Business Logic                           │
  // └──────────────────────────────────────────┘
  const result = await registerAction(payload);
  return result;
});
```

#### Controller: `controllers/auth/login/index.ts`
```
tracer.trace('CONTROLLER.AUTH.LOGIN', async () => {
  const result = await loginAction(payload);
  return result;
});
```

### 8.2 Profile Routes (`services/api/src/routes/v1/profile.ts`)

| Method | Path | Auth | Controller | Joi Payload |
|---|---|---|---|---|
| POST | `/api/v1/profile/update` | Bearer JWT | `updateProfile` | `{ email?: string().email(), password?: string().min(6).max(128), voice_id?: string(), input_language?: string().valid('en','es','de','he','lo'), output_language?: string().valid('en','es','de','he','lo'), volume?: number().min(0).max(1), use_premium_voice?: boolean(), hear_own_voice?: boolean() }` |

#### Controller: `controllers/profile/updateProfile/index.ts`
```
tracer.trace('CONTROLLER.PROFILE.UPDATE', async () => {
  const userId = request.auth.credentials.id;
  const result = await updateProfileAction({ userId, updates: payload });
  return result;
});
```

### 8.3 Payment Routes (`services/api/src/routes/v1/payment.ts`)

| Method | Path | Auth | Controller | Joi Payload/Params |
|---|---|---|---|---|
| POST | `/api/v1/payment/create-checkout` | Bearer JWT | `createCheckout` | (none) |
| POST | `/api/v1/payment/webhook` | None (Stripe signature) | `webhook` | Raw body (parse: false) |
| POST | `/api/v1/payment/portal` | Bearer JWT | `createPortal` | (none) |
| GET | `/api/v1/payment/status` | Bearer JWT | `getStatus` | (none) |

#### Controller: `controllers/payment/webhook/index.ts`
```
tracer.trace('CONTROLLER.PAYMENT.WEBHOOK', async () => {
  // ┌──────────────────────────────────────────┐
  // │ Validation                               │
  // └──────────────────────────────────────────┘
  const signature = request.headers['stripe-signature'];
  const event = stripeAdapter.constructWebhookEvent(request.payload, signature);

  // ┌──────────────────────────────────────────┐
  // │ Business Logic                           │
  // └──────────────────────────────────────────┘
  await handleWebhookAction(event);
  return { received: true };
});
```

**Note:** The webhook route must be configured with `payload: { parse: false, output: 'data' }` in Hapi to receive the raw body for Stripe signature verification.

#### Controller: `controllers/payment/createCheckout/index.ts`
```
tracer.trace('CONTROLLER.PAYMENT.CREATE_CHECKOUT', async () => {
  const user = request.auth.credentials;
  const result = await createCheckoutAction({
    userId: user.id,
    email: user.email || `${user.username}@commslink.local`,
    username: user.username,
  });
  return result;
});
```

#### Controller: `controllers/payment/createPortal/index.ts`
```
tracer.trace('CONTROLLER.PAYMENT.CREATE_PORTAL', async () => {
  const user = await Data.user.findById(request.auth.credentials.id);
  if (!user?.stripe_customer_id) throw Boom.badRequest('No subscription found');
  const session = await stripeAdapter.createCustomerPortalSession(user.stripe_customer_id);
  return { url: session.url };
});
```

#### Controller: `controllers/payment/getStatus/index.ts`
```
tracer.trace('CONTROLLER.PAYMENT.GET_STATUS', async () => {
  const user = await Data.user.findById(request.auth.credentials.id);
  return {
    isPremium: user.is_premium,
    expiresAt: user.premium_expires_at,
  };
});
```

### 8.4 Voice Routes (`services/api/src/routes/v1/voice.ts`)

| Method | Path | Auth | Controller | Joi Payload |
|---|---|---|---|---|
| POST | `/api/v1/voice/generate` | Bearer JWT | `generate` | `{ text: string().max(500).required(), voiceId: string().required() }` |
| GET | `/api/v1/voice/list` | Bearer JWT | `listVoices` | (none) |

#### Controller: `controllers/voice/generate/index.ts`
```
tracer.trace('CONTROLLER.VOICE.GENERATE', async () => {
  const { text, voiceId } = request.payload;
  const result = await generatePremiumAudioAction({
    userId: request.auth.credentials.id,
    text,
    voiceId,
  });
  return result;
});
```

#### Controller: `controllers/voice/listVoices/index.ts`
```
tracer.trace('CONTROLLER.VOICE.LIST', async () => {
  const result = await listVoicesAction({
    userId: request.auth.credentials.id,
  });
  return result;
});
```

### 8.5 Forum Routes (`services/api/src/routes/v1/forum.ts`)

| Method | Path | Auth | Controller | Joi Payload/Params/Query |
|---|---|---|---|---|
| GET | `/api/v1/forum/threads` | None | `getThreads` | Query: `{ page?: number().default(1), limit?: number().default(20) }` |
| GET | `/api/v1/forum/threads/{threadId}` | None | `getThread` | Params: `{ threadId: string().uuid().required() }` |
| POST | `/api/v1/forum/threads` | Bearer JWT | `createThread` | `{ title: string().min(3).max(200).required() }` |
| POST | `/api/v1/forum/threads/{threadId}/posts` | Bearer JWT | `createPost` | Params: `{ threadId: string().uuid() }`, Payload: `{ content: string().min(1).max(10000).required() }` |
| DELETE | `/api/v1/forum/posts/{postId}` | Bearer JWT | `deletePost` | Params: `{ postId: string().uuid().required() }` |

#### Controller: `controllers/forum/getThreads/index.ts`
```
tracer.trace('CONTROLLER.FORUM.GET_THREADS', async () => {
  const { page, limit } = request.query;
  const threads = await Data.thread.findAll({ skip: (page - 1) * limit, take: limit });
  return threads;
});
```

#### Controller: `controllers/forum/getThread/index.ts`
```
tracer.trace('CONTROLLER.FORUM.GET_THREAD', async () => {
  const { threadId } = request.params;
  const thread = await Data.thread.findById(threadId);
  if (!thread) throw Boom.notFound('Thread not found');
  Data.thread.incrementViewCount(threadId).catch(console.error);
  const posts = await Data.post.findByThreadId(threadId, { skip: 0, take: 100 });
  return { thread, posts };
});
```

#### Controller: `controllers/forum/createThread/index.ts`
```
tracer.trace('CONTROLLER.FORUM.CREATE_THREAD', async () => {
  const { title } = request.payload;
  const { id, username } = request.auth.credentials;
  const result = await createThreadAction({ title, authorId: id, authorUsername: username });
  return result;
});
```

#### Controller: `controllers/forum/createPost/index.ts`
```
tracer.trace('CONTROLLER.FORUM.CREATE_POST', async () => {
  const { threadId } = request.params;
  const { content } = request.payload;
  const { id, username } = request.auth.credentials;
  const result = await createPostAction({
    threadId,
    authorId: id,
    authorUsername: username,
    content,
  });
  return result;
});
```

#### Controller: `controllers/forum/deletePost/index.ts`
```
tracer.trace('CONTROLLER.FORUM.DELETE_POST', async () => {
  const { postId } = request.params;
  const result = await deletePostAction({
    postId,
    requestingUserId: request.auth.credentials.id,
  });
  return result;
});
```

### 8.6 Admin Routes (`services/api/src/routes/v1/admin.ts`)

| Method | Path | Auth | Controller | Joi Payload |
|---|---|---|---|---|
| GET | `/api/v1/admin/dashboard` | Bearer JWT + Admin | `getDashboard` | (none) |
| POST | `/api/v1/admin/toggle-premium` | Bearer JWT + Admin | `togglePremium` | `{ userId: string().uuid().required(), isPremium: boolean().required() }` |
| POST | `/api/v1/admin/toggle-ban` | Bearer JWT + Admin | `toggleBan` | `{ userId: string().uuid().required(), isBanned: boolean().required() }` |

**Admin check:** A Hapi route prerequisite or `pre` handler that verifies `request.auth.credentials.is_admin === true`, throwing `Boom.forbidden('Admin access required')` if not.

#### Controller: `controllers/admin/getDashboard/index.ts`
```
tracer.trace('CONTROLLER.ADMIN.GET_DASHBOARD', async () => {
  const result = await getDashboardAction();
  return result;
});
```

#### Controller: `controllers/admin/togglePremium/index.ts`
```
tracer.trace('CONTROLLER.ADMIN.TOGGLE_PREMIUM', async () => {
  const { userId, isPremium } = request.payload;
  const result = await togglePremiumAction({ userId, isPremium });
  return result;
});
```

#### Controller: `controllers/admin/toggleBan/index.ts`
```
tracer.trace('CONTROLLER.ADMIN.TOGGLE_BAN', async () => {
  const { userId, isBanned } = request.payload;
  const result = await toggleBanAction({ userId, isBanned });
  return result;
});
```

### 8.7 Version Routes (`services/api/src/routes/v1/version.ts`)

| Method | Path | Auth | Controller |
|---|---|---|---|
| GET | `/api/v1/versions` | None | `getVersions` |

#### Controller: `controllers/version/getVersions/index.ts`
```
tracer.trace('CONTROLLER.VERSION.GET_VERSIONS', async () => {
  const result = await getVersionsAction();
  return result;
});
```

### 8.8 Stats Middleware

A Hapi `onPreResponse` extension or route-level `ext` that increments visit count on page-serving routes:

```typescript
// In server.ts
server.ext('onPreHandler', async (request, h) => {
  if (request.path === '/' || request.path === '/api/v1/health') {
    Data.dailyStats.incrementVisits(dayjs().format('YYYY-MM-DD')).catch(console.error);
  }
  return h.continue;
});
```

---

## 9. Backend: Socket Handlers

### 9.1 `services/api/src/handlers/chat/index.ts`

The socket layer manages real-time state. It integrates Socket.IO with the Hapi server.

#### In-Memory State
```typescript
const connectedUsers = new Map<string, ConnectedUser>();
// ConnectedUser = { userId, username, socketId, currentRoom }

const activeRooms = new Map<string, ActiveRoom>();
// ActiveRoom = { users: Set<string>, password_hash: string | null, displayName: string, createdBy: string | null }
```

#### Socket Events (Server listens):

| Event | Payload | Handler | Emits |
|---|---|---|---|
| `connection` | (automatic) | Add user to connectedUsers, join "public" room, broadcast roster + room list | `room_joined`, `roster_update`, `room_list_update` |
| `chat_message` | `{ text, voice, audio, original }` | Format via broadcastMessageAction, emit to room | `chat_message` (to room) |
| `create_room` | `{ roomName, password }` | Validate name, hash password, create room, auto-join creator | `room_created`, `room_joined`, `room_list_update` |
| `join_room` | `{ roomName, password }` | Verify password, add user to room | `room_joined`, `room_list_update` or `room_join_error` |
| `switch_room` | `{ roomName }` | Leave current, join new (public or no-password rooms only) | `room_joined`, `room_list_update` or `room_join_error` |
| `disconnect` | (automatic) | Remove from room + connectedUsers, cleanup empty rooms | `roster_update`, `room_list_update` |

#### Socket Events (Server emits):

| Event | Payload | Recipients |
|---|---|---|
| `roster_update` | `ConnectedUser[]` | All connected |
| `chat_message` | `FormattedMessage` | Users in same room |
| `room_list_update` | `{ rooms: RoomListItem[] }` | All connected |
| `room_joined` | `{ roomName, users: ConnectedUser[] }` | Joining user |
| `room_created` | `{ success, roomName } \| { success: false, error }` | Creating user |
| `room_join_error` | `{ error: string }` | Attempting user |

#### Socket Auth Middleware
```typescript
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));

  const decoded = verifyJwt(token);
  if (!decoded) return next(new Error('Authentication error'));

  const user = await Data.user.findById(decoded.id);
  if (!user) return next(new Error('Authentication error'));
  if (user.is_banned) return next(new Error('Account banned'));

  socket.user = decoded;
  next();
});
```

#### Message Stats Tracking
On `chat_message`, fire-and-forget: `Data.dailyStats.incrementMessages(today)`.

---

## 10. Backend: Middleware & Auth

### 10.1 `core/lib/hapi/auth.ts` — JWT Auth Strategy

```typescript
// Registers a Hapi auth strategy 'jwt'
// Uses hapi-auth-bearer-token plugin
// Validates by:
//   1. Verifying JWT signature
//   2. Looking up user in DB
//   3. Checking ban status
//   4. Returning credentials: { id, username, email, is_admin, is_premium }
```

### 10.2 `core/helpers/jwt.ts`

| Function | Signature | Description |
|---|---|---|
| `signToken` | `(payload: JwtPayload) => string` | Sign JWT with secret from env |
| `verifyToken` | `(token: string) => JwtPayload \| null` | Verify and decode, return null on failure |

`JWT_SECRET` loaded from environment (never hardcoded).

### 10.3 `core/helpers/password.ts`

| Function | Signature | Description |
|---|---|---|
| `hashPassword` | `(password: string) => Promise<string>` | bcrypt hash (salt rounds: 10) |
| `verifyPassword` | `(password: string, hash: string) => Promise<boolean>` | bcrypt compare |

### 10.4 Admin Prerequisite

A Hapi `pre` handler used on admin routes:

```typescript
const requireAdmin = {
  method: async (request: Request) => {
    if (!request.auth.credentials.is_admin) {
      throw Boom.forbidden('Admin access required');
    }
    return true;
  },
  assign: 'adminCheck',
};
```

---

## 11. Frontend: Pages & Routing

### 11.1 Route Map

| Path | Page Component | Auth Required | Layout |
|---|---|---|---|
| `/` | Redirect to `/chat` or `/login` | Check session | — |
| `/login` | `AuthForm` (login mode) | No | `AuthLayout` |
| `/register` | `AuthForm` (register mode) | No | `AuthLayout` |
| `/chat` | Main chat interface | Yes | `AppLayout` |
| `/forum` | Thread list | Yes | `AppLayout` |
| `/forum/[threadId]` | Thread detail with posts | Yes | `AppLayout` |
| `/settings` | User profile & preferences | Yes | `AppLayout` |
| `/admin` | Admin dashboard | Yes + Admin | `AppLayout` |

### 11.2 Page Descriptions

#### `/login` — `app/login/page.tsx`
- Renders `AuthForm` in login mode
- On success: store token in iron-session cookie via `/api/auth/login`, redirect to `/chat`
- Link to `/register`

#### `/register` — `app/register/page.tsx`
- Renders `AuthForm` in register mode
- On success: store token in iron-session cookie via `/api/auth/register`, redirect to `/chat`
- Link to `/login`

#### `/chat` — `app/chat/page.tsx`
- The main app page. Discord-like three-column layout:
  - Left: `ChannelSidebar` (room list + create room button + `UserPanel` at bottom)
  - Center: `ChatArea` (messages + `MessageInput`)
  - Right: `MemberList` (online users in current room)
- Socket.IO connection established on mount
- Handles all socket events (roster, messages, rooms)
- Speech recognition controls in `MessageInput`

#### `/forum` — `app/forum/page.tsx`
- Lists all threads with title, author, reply count, view count, last reply date
- "New Thread" button opens modal/form
- Click thread navigates to `/forum/[threadId]`

#### `/forum/[threadId]` — `app/forum/[threadId]/page.tsx`
- Thread title + metadata at top
- Chronological list of posts
- Reply form at bottom
- Delete button on own posts

#### `/settings` — `app/settings/page.tsx`
- Tabbed interface (Profile, Voice, Subscription)
- **Profile tab**: email, password change
- **Voice tab**: voice avatar selection, input/output language, volume slider, hear own voice toggle, premium voice toggle
- **Subscription tab**: premium status, manage subscription button, upgrade button

#### `/admin` — `app/admin/page.tsx`
- Admin-only (redirect if not admin)
- User table with premium/ban toggles
- Stats charts (visits + messages over last 30 days)

### 11.3 Next.js API Routes (Session Proxy) — `pages/api/`

These are thin session management endpoints. The frontend calls these, which then proxy to the Hapi backend.

| Path | Method | Description |
|---|---|---|
| `/api/auth/login` | POST | Call backend `/api/v1/auth/login`, store token in iron-session |
| `/api/auth/register` | POST | Call backend `/api/v1/auth/register`, store token in iron-session |
| `/api/auth/logout` | POST | Destroy iron-session |
| `/api/auth/session` | GET | Return current session (for `useSession` SWR hook) |
| `/api/[...proxy]` | ALL | Proxy requests to backend API with bearer token from session |

---

## 12. Frontend: Components

### 12.1 Layout Components

#### `AppLayout` — Discord-style authenticated shell
```
┌─────────────────────────────────────────────────────────┐
│ TopBar (room name, search, settings gear)                │
├────────┬──────────────────────────────────┬──────────────┤
│        │                                  │              │
│Channel │         ChatArea                 │  MemberList  │
│Sidebar │         (Messages)               │  (Online)    │
│        │                                  │              │
│        │                                  │              │
│ Rooms  │                                  │              │
│ List   │──────────────────────────────────│              │
│        │  MessageInput (text + mic)       │              │
├────────┴──────────────────────────────────┴──────────────┤
│ UserPanel (avatar, username, mic/deafen/settings)        │
└─────────────────────────────────────────────────────────┘
```

#### `AuthLayout` — Centered card for login/register
```
┌─────────────────────────────────────────┐
│                                         │
│         ┌───────────────────┐           │
│         │   CommsLink Logo  │           │
│         │                   │           │
│         │   AuthForm        │           │
│         │                   │           │
│         └───────────────────┘           │
│                                         │
└─────────────────────────────────────────┘
```

### 12.2 Chat Components

#### `ChannelSidebar/index.tsx`
- Props: `rooms: RoomListItem[], currentRoom: string, onSwitchRoom, onCreateRoom`
- Shows "Text Channels" header
- List of rooms with `#` prefix (Discord style)
- User count per room
- Lock icon for password-protected rooms
- "+" button to create room
- Active room highlighted

#### `ChatArea/index.tsx`
- Props: `messages: Message[], currentRoom: string, onSendMessage`
- Scrollable message list
- Auto-scroll to bottom on new message
- Date separators between message groups
- Contains `MessageBubble` and `MessageInput` subcomponents

#### `MessageBubble/index.tsx`
- Props: `message: Message, isSelf: boolean`
- Username (colored), timestamp, message text
- If `message.original` exists, show translation format: "Original (Translation)"
- Audio playback button if `message.audio` exists
- Discord-style: avatar on left, content on right

#### `MessageInput/index.tsx`
- Props: `onSend, inputLanguage, onStartMic, onStopMic, isRecording`
- Text input with send button
- Microphone toggle button (changes color when recording)
- Language selector dropdown
- Enter to send
- Emoji button (future)

#### `MemberList/index.tsx`
- Props: `users: ConnectedUser[]`
- "Online — N" header
- List of usernames with online indicator dot
- Premium badge for premium users

#### `UserPanel/index.tsx`
- Props: `user: User, onLogout, onOpenSettings`
- User avatar (first letter circle)
- Username + premium badge
- Mic mute/unmute button
- Volume/deafen button
- Settings gear icon
- Discord-style bottom-left panel

#### `VoiceControls/index.tsx`
- Props: `voiceAvatar, onChangeVoice, volume, onChangeVolume, hearOwnVoice, onToggleHearOwn, isPremium, usePremiumVoice, onTogglePremiumVoice, premiumVoices`
- Voice avatar dropdown (male/female/robot + premium voices)
- Volume slider
- "Hear own voice" toggle
- "Use premium voices" toggle (triggers Stripe checkout if not premium)

#### `CreateRoomModal/index.tsx`
- Props: `open, onClose, onSubmit`
- MUI Dialog
- Room name input (3-30 chars, alphanumeric)
- Optional password input
- Create button

#### `RoomPasswordModal/index.tsx`
- Props: `open, roomName, onClose, onSubmit, error`
- MUI Dialog
- Password input
- Join button
- Error message display

#### `PremiumBadge/index.tsx`
- Props: `size?: 'small' | 'medium'`
- Small colored badge/chip indicating premium status

### 12.3 Forum Components

#### `ForumThreadList/index.tsx`
- Props: `threads: Thread[], onCreateThread`
- Table/list of threads
- Columns: title, author, replies, views, last activity
- "New Thread" button
- Click row to navigate

#### `ForumThread/index.tsx`
- Props: `thread: Thread, posts: Post[], onCreatePost, onDeletePost, currentUserId`
- Thread title header
- Post list (each with author, content, date, delete button if owner)
- Reply form at bottom (React Hook Form + Yup)

### 12.4 Settings Components

#### `SettingsPanel/index.tsx`
- Tabbed interface container
- Three tabs: Profile, Voice, Subscription

#### `ProfileTab/index.tsx`
- Props: `user, onUpdate`
- Email field (React Hook Form)
- Password / confirm password fields
- Save button

#### `VoiceTab/index.tsx`
- Props: `user, isPremium, premiumVoices, onUpdate`
- Voice avatar dropdown
- Input language dropdown
- Output language dropdown
- Volume slider
- Hear own voice toggle
- Premium voice toggle
- Test voice button

#### `SubscriptionTab/index.tsx`
- Props: `isPremium, expiresAt, onUpgrade, onManage`
- Current status display
- Upgrade to Premium button (if not premium)
- Manage Subscription button (if premium, opens Stripe portal)

### 12.5 Admin Components

#### `AdminDashboard/index.tsx`
- Container for admin page content

#### `UserTable/index.tsx`
- Props: `users: UserListItem[], onTogglePremium, onToggleBan`
- MUI DataGrid or Table
- Columns: username, email, premium (toggle switch), banned (toggle switch), joined date

#### `StatsChart/index.tsx`
- Props: `stats: DailyStat[]`
- Two line charts: visits over time, messages over time
- Using Recharts (line chart with Discord-dark background)

### 12.6 Auth Components

#### `AuthForm/index.tsx`
- Props: `mode: 'login' | 'register', onSubmit, error`
- React Hook Form + Yup validation
- Username field
- Password field
- Confirm password field (register mode only)
- Submit button
- Toggle link ("Already have an account?" / "Need an account?")

### 12.7 `TopBar/index.tsx`
- Props: `roomName, onOpenSettings`
- Shows `#room-name` with hash icon
- Settings/gear icon on right
- Clean, minimal Discord-style header bar

---

## 13. Frontend: API Modules

All in `web-portal/lib/api/`, following CLAUDEFrontend.md pattern.

### 13.1 `base.ts`
```typescript
// Axios instance with baseURL from settings/config.json
// authHeaders(token) helper
// handle(promise) wrapper for consistent error handling
```

### 13.2 `auth.ts`

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `login(username, password)` | POST | `/api/auth/login` (Next.js proxy) | No |
| `register(username, password)` | POST | `/api/auth/register` (Next.js proxy) | No |
| `logout()` | POST | `/api/auth/logout` (Next.js proxy) | Session |
| `getSession()` | GET | `/api/auth/session` (Next.js proxy) | Session |

### 13.3 `profile.ts`

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `updateProfile(token, data)` | POST | `/api/v1/profile/update` | Bearer |

### 13.4 `payment.ts`

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `createCheckout(token)` | POST | `/api/v1/payment/create-checkout` | Bearer |
| `getStatus(token)` | GET | `/api/v1/payment/status` | Bearer |
| `openPortal(token)` | POST | `/api/v1/payment/portal` | Bearer |

### 13.5 `voice.ts`

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `generate(token, text, voiceId)` | POST | `/api/v1/voice/generate` | Bearer |
| `listVoices(token)` | GET | `/api/v1/voice/list` | Bearer |

### 13.6 `forum.ts`

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `getThreads(token, page, limit)` | GET | `/api/v1/forum/threads` | Bearer |
| `getThread(token, threadId)` | GET | `/api/v1/forum/threads/:id` | Bearer |
| `createThread(token, title)` | POST | `/api/v1/forum/threads` | Bearer |
| `createPost(token, threadId, content)` | POST | `/api/v1/forum/threads/:id/posts` | Bearer |
| `deletePost(token, postId)` | DELETE | `/api/v1/forum/posts/:id` | Bearer |

### 13.7 `admin.ts`

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `getDashboard(token)` | GET | `/api/v1/admin/dashboard` | Bearer |
| `togglePremium(token, userId, isPremium)` | POST | `/api/v1/admin/toggle-premium` | Bearer |
| `toggleBan(token, userId, isBanned)` | POST | `/api/v1/admin/toggle-ban` | Bearer |

### 13.8 `version.ts`

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `getVersions()` | GET | `/api/v1/versions` | No |

---

## 14. Frontend: State & Context

### 14.1 `UserContext`
```typescript
type UserState = {
  user: User | null;
  token: string | null;
  isPremium: boolean;
  isAdmin: boolean;
  isLoading: boolean;
};
```
Provided at root layout. Populated by `useSession()` hook on mount.

### 14.2 `ChatStateProvider`
```typescript
type ChatState = {
  currentRoom: string;
  rooms: RoomListItem[];
  messages: Message[];
  onlineUsers: ConnectedUser[];
  isRecording: boolean;
  inputLanguage: string;
  outputLanguage: string;
  voiceAvatar: string;
  volume: number;
  hearOwnVoice: boolean;
  usePremiumVoices: boolean;
};
```
Manages all real-time chat state. Connects socket, registers event listeners, provides dispatch methods.

### 14.3 Socket Client — `lib/socket/index.ts`
```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (token: string): Socket => {
  if (!socket) {
    socket = io(API_URL, {
      autoConnect: false,
      auth: { token },
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
```

---

## 15. Frontend: Styling (Discord Theme)

### 15.1 Color Palette — `styles/colorVariables.scss`

```scss
// Discord Dark Theme Colors
$background-primary: #313338;        // Main content area
$background-secondary: #2b2d31;      // Sidebars
$background-tertiary: #1e1f22;       // Server list, deepest bg
$background-floating: #111214;       // Modals, popups
$background-accent: #404249;         // Hover states

$text-primary: #f2f3f5;              // Main text
$text-secondary: #b5bac1;            // Muted text
$text-muted: #949ba4;                // Timestamps, subtle text
$text-link: #00a8fc;                 // Links

$brand-primary: #5865f2;             // Discord blurple (buttons, accents)
$brand-hover: #4752c4;               // Button hover
$status-online: #23a559;             // Online indicator
$status-idle: #f0b232;               // Idle indicator
$status-dnd: #f23f43;                // Do not disturb / errors
$status-offline: #80848e;            // Offline indicator

$premium-gold: #f0b132;              // Premium badge color

$channel-default: #949ba4;           // Channel text color
$channel-hover: #dbdee1;             // Channel text on hover

$input-background: #383a40;          // Input fields
$scrollbar-thin-thumb: #1a1b1e;      // Scrollbar
$scrollbar-auto-thumb: #2b2d31;      // Scrollbar

$divider: #3f4147;                   // Horizontal rules
$elevation-low: rgba(0, 0, 0, 0.2);  // Card shadows
```

### 15.2 Global Styles — `styles/globals.scss`

```scss
@use './colorVariables.scss' as *;

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  background-color: $background-primary;
  color: $text-primary;
  font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.375;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: $scrollbar-thin-thumb;
  border-radius: 4px;
}

a {
  color: $text-link;
  text-decoration: none;
  &:hover { text-decoration: underline; }
}

// Utility
.hidden { display: none !important; }
```

### 15.3 MUI Dark Theme — `themes/DarkTheme.tsx`

```typescript
import { createTheme } from '@mui/material/styles';

const DarkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#5865f2' },
    secondary: { main: '#f0b132' },
    background: {
      default: '#313338',
      paper: '#2b2d31',
    },
    text: {
      primary: '#f2f3f5',
      secondary: '#b5bac1',
    },
    error: { main: '#f23f43' },
    success: { main: '#23a559' },
    divider: '#3f4147',
  },
  typography: {
    fontFamily: '"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 3,
        },
        containedPrimary: {
          '&:hover': { backgroundColor: '#4752c4' },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: '#313338',
          borderRadius: 8,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#1e1f22',
          },
        },
      },
    },
  },
});

export default DarkTheme;
```

### 15.4 Key Layout Styles

#### Chat Layout (Discord Three-Column)
```scss
// AppLayout.module.scss
.appContainer {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.channelSidebar {
  width: 240px;
  background-color: $background-secondary;
  display: flex;
  flex-direction: column;
}

.mainContent {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: $background-primary;
}

.memberList {
  width: 240px;
  background-color: $background-secondary;
  border-left: 1px solid $divider;
}
```

#### Message Styles
```scss
// MessageBubble.module.scss
.messageContainer {
  padding: 2px 16px;
  display: flex;
  gap: 16px;

  &:hover {
    background-color: rgba(0, 0, 0, 0.06);
  }
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: $brand-primary;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
}

.username {
  font-weight: 600;
  font-size: 1rem;
  color: $text-primary;
  margin-right: 8px;
}

.timestamp {
  font-size: 0.75rem;
  color: $text-muted;
}

.content {
  color: $text-secondary;
  font-size: 1rem;
  line-height: 1.375;
  word-wrap: break-word;
}
```

#### Channel Sidebar
```scss
// ChannelSidebar.module.scss
.header {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 1rem;
  color: $text-primary;
  border-bottom: 1px solid $divider;
  height: 48px;
  display: flex;
  align-items: center;
}

.category {
  padding: 16px 8px 4px 16px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: $channel-default;
  letter-spacing: 0.02em;
}

.channel {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin: 1px 8px;
  border-radius: 4px;
  color: $channel-default;
  cursor: pointer;
  font-size: 1rem;
  gap: 6px;

  &:hover {
    background-color: $background-accent;
    color: $channel-hover;
  }

  &.active {
    background-color: $background-accent;
    color: $text-primary;
    font-weight: 500;
  }
}

.channelHash {
  font-size: 1.25rem;
  color: $channel-default;
  font-weight: 400;
}

.userCount {
  margin-left: auto;
  font-size: 0.75rem;
  color: $text-muted;
}
```

#### User Panel (Bottom-Left)
```scss
// UserPanel.module.scss
.panel {
  padding: 0 8px;
  height: 52px;
  background-color: $background-tertiary;
  display: flex;
  align-items: center;
  gap: 8px;
}

.userInfo {
  flex: 1;
  min-width: 0;
}

.displayName {
  font-size: 0.875rem;
  font-weight: 600;
  color: $text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.controls {
  display: flex;
  gap: 4px;
}

.controlBtn {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: $text-secondary;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: $background-accent;
    color: $text-primary;
  }

  &.recording {
    color: $status-dnd;
  }
}
```

---

## 16. Infrastructure & Deployment

### 16.1 Local Development

```yaml
# docker-compose.yml
services:
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: commslink_dev
      MYSQL_DATABASE: commslink
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  mysql_data:
```

### 16.2 Environment Variables

```env
# Backend (.env)
DATABASE_URL=mysql://root:commslink_dev@localhost:3306/commslink
JWT_SECRET=<generate-a-real-secret>
ELEVENLABS_API_KEY=sk_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
CLIENT_URL=http://localhost:3000
PORT=4000

# Frontend (settings/config.local.json)
{
  "API_HOSTNAME": "http://localhost:4000"
}
```

### 16.3 EC2 Deployment Plan

1. **Prepare EC2** (the `CommsLink2` t2.medium instance at 3.134.145.169):
   - Install Node 18.20.8 via nvm
   - Install MySQL 8.0
   - Install nginx
   - Configure SSL (Let's Encrypt for commslink.net)

2. **Deploy Backend**:
   - Clone repo to `/home/ec2-user/app`
   - Run `npx prisma migrate deploy`
   - Start via PM2: `pm2 start services/api/src/index.ts --name commslink-api`

3. **Deploy Frontend**:
   - Build: `cd web-portal && yarn build`
   - Start via PM2: `pm2 start npm --name commslink-web -- start`

4. **Nginx Config**:
   ```nginx
   # Backend API
   server {
       listen 443 ssl;
       server_name api.commslink.net;
       # ... SSL config ...
       location / {
           proxy_pass http://localhost:4000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }

   # Frontend
   server {
       listen 443 ssl;
       server_name commslink.net www.commslink.net;
       # ... SSL config ...
       location / {
           proxy_pass http://localhost:3000;
       }
   }
   ```

5. **Data Migration**: Export existing SQLite data from the `commslink` t3.micro instance, transform to MySQL-compatible INSERT statements, import into the new MySQL database.

6. **DNS Cutover**: Point commslink.net to the new `CommsLink2` instance (3.134.145.169) once verified.

---

## 17. Implementation Phases

### Phase 1: Foundation (Backend Skeleton)
- [ ] Initialize monorepo (yarn workspaces, tsconfig, package.json)
- [ ] Set up Prisma schema + initial migration
- [ ] Set up docker-compose (MySQL)
- [ ] Create `core/` package structure (data/, actions/, adapters/, helpers/, interfaces/, lib/, constants/)
- [ ] Implement `core/adapters/prisma.ts`
- [ ] Implement `core/helpers/password.ts` and `core/helpers/jwt.ts`
- [ ] Implement `core/data/user/index.ts`
- [ ] Set up Hapi server (`services/api/src/server.ts`)
- [ ] Implement JWT auth strategy (`core/lib/hapi/auth.ts`)
- [ ] Implement auth routes + controllers + actions (register, login)
- [ ] Verify: can register, login, get JWT, access protected routes

### Phase 2: Core Backend Features
- [ ] Implement `core/data/room/index.ts`
- [ ] Implement `core/data/dailyStats/index.ts`
- [ ] Implement Socket.IO integration on Hapi
- [ ] Implement chat handler (connect, disconnect, message, rooms)
- [ ] Implement profile update route + action + data
- [ ] Implement version route + data
- [ ] Verify: socket connects, messages broadcast, rooms work

### Phase 3: External Integrations
- [ ] Implement `core/adapters/stripe/index.ts`
- [ ] Implement `core/adapters/elevenlabs/index.ts`
- [ ] Implement payment routes + actions (checkout, webhook, portal, status)
- [ ] Implement voice routes + actions (generate, list)
- [ ] Verify: Stripe checkout flow works, ElevenLabs TTS returns audio

### Phase 4: Forum & Admin
- [ ] Implement `core/data/thread/index.ts` and `core/data/post/index.ts`
- [ ] Implement forum routes + controllers + actions
- [ ] Implement admin routes + controllers + actions
- [ ] Verify: CRUD operations on threads/posts, admin dashboard data

### Phase 5: Frontend Foundation
- [ ] Initialize Next.js 14 project (`web-portal/`)
- [ ] Set up MUI dark theme, ThemeRegistry, global SCSS
- [ ] Set up iron-session, auth pages, session hooks
- [ ] Implement `AuthLayout` + `AuthForm`
- [ ] Implement login/register flow
- [ ] Set up API modules (`lib/api/`)
- [ ] Verify: can login, session persists, redirects work

### Phase 6: Frontend Chat
- [ ] Implement `AppLayout` (Discord three-column shell)
- [ ] Implement `ChannelSidebar` + room list
- [ ] Implement `ChatArea` + `MessageBubble` + `MessageInput`
- [ ] Implement `MemberList`
- [ ] Implement `UserPanel`
- [ ] Implement Socket.IO client + `ChatStateProvider`
- [ ] Implement `CreateRoomModal` + `RoomPasswordModal`
- [ ] Verify: full chat flow — login, send messages, switch rooms, see online users

### Phase 7: Frontend Features
- [ ] Implement `VoiceControls` (mic, voice selection, volume)
- [ ] Implement speech recognition integration
- [ ] Implement client-side TTS (browser + ElevenLabs)
- [ ] Implement translation (MyMemory client-side)
- [ ] Implement `SettingsPanel` (Profile, Voice, Subscription tabs)
- [ ] Implement forum pages + components
- [ ] Implement admin page + components
- [ ] Verify: voice works, settings save, forum CRUD, admin tools

### Phase 8: Polish & Deploy
- [ ] Responsive design pass (mobile layout)
- [ ] Error handling (toast notifications, error boundaries)
- [ ] Loading states (skeletons, spinners)
- [ ] Run `tsc --noEmit` to verify all types
- [ ] Run `yarn lint` on both backend and frontend
- [ ] Data migration from SQLite to MySQL
- [ ] Deploy to EC2 (CommsLink2 instance)
- [ ] Nginx + SSL configuration
- [ ] DNS cutover
- [ ] Decommission old `commslink` t3.micro instance

---

## 18. Migration Strategy

### 18.1 Data Migration (SQLite -> MySQL)

1. SSH into old `commslink` instance
2. Export users table: `sqlite3 comms.db ".dump users"` -> transform to MySQL INSERT
3. Export threads, posts, daily_stats, versions
4. Map SQLite INTEGER ids to UUIDs (generate UUIDs, maintain a mapping table)
5. Re-hash passwords? No — bcrypt hashes are portable, keep them
6. Import into MySQL on the new instance
7. Verify row counts match

### 18.2 Stripe Migration

- Existing `stripe_customer_id` values remain valid — Stripe is the source of truth
- No changes needed on the Stripe side
- Update webhook endpoint URL in Stripe dashboard to point to new API

### 18.3 DNS Cutover

1. Verify new app is fully functional on `3.134.145.169`
2. Update Route 53 / DNS provider: `commslink.net` A record -> `3.134.145.169`
3. Update Stripe webhook URL
4. Update `CLIENT_URL` env var
5. Monitor for 24 hours
6. Terminate old `commslink` t3.micro instance

---

## Summary

This plan covers every route, controller, action, data function, adapter, Prisma model, frontend component, API module, and styling decision needed to rewrite CommsLink from scratch. The architecture follows the three-layer pattern from CLAUDE.md (Controllers -> Actions -> Data) with proper TypeScript typing, Joi validation, DataDog tracing, and a Discord-inspired dark theme.

Total counts:
- **Prisma models**: 6 (user, room, thread, post, daily_stats, app_version)
- **Data layer functions**: ~28
- **Actions**: ~14
- **Adapters**: 3 (Prisma, Stripe, ElevenLabs)
- **Backend routes**: 16
- **Backend controllers**: 16
- **Socket events**: 5 inbound, 6 outbound
- **Frontend pages**: 7
- **Frontend components**: ~22
- **Frontend API modules**: 7
- **SCSS module files**: ~20+
