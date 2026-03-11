# CLAUDEFrontend.md

This file provides guidance to Claude Code when working with the frontend web portal.

## Project Overview

This is the CommsLink web portal, a hybrid Next.js 14 application using the App Router (`app/`) for pages and the Pages Router (`pages/api/`) for API routes. Built with React 18, TypeScript, and MUI 7.

## Tech Stack

- **Framework**: Next.js 14 (App Router + Pages Router for API routes)
- **Language**: TypeScript (strict mode, ES6 target, bundler module resolution)
- **UI Library**: MUI (Material UI) 7 with Emotion
- **Styling**: SCSS modules + MUI `sx` prop (see Styling section)
- **Forms**: React Hook Form + Yup validation
- **Data Fetching**: SWR (stale-while-revalidate), Axios
- **Auth**: iron-session (server-side encrypted cookies), NOT NextAuth
- **Real-time**: Socket.io client
- **Charts**: Chart.js / react-chartjs-2, Recharts
- **Monitoring**: Datadog RUM
- **Testing**: Jest + React Testing Library (ts-jest, jsdom)
- **Package Manager**: Yarn
- **Node Version**: 22.18.0

## Commands

- `yarn watch` - Start dev server
- `yarn build` - Production build
- `yarn lint` - Run ESLint
- `yarn test` - Run Jest tests

## Project Structure

```
app/             - App Router pages (routes, layout, error boundary)
pages/api/       - API route handlers (auth, session, user)
components/      - Reusable React components (folder-per-component with index.tsx)
layouts/         - Custom layout wrappers (PromptLayout, Dashboard)
lib/             - API clients, helpers, context providers, state, socket
  lib/api/       - Axios-based API modules (one per domain)
  lib/helpers/   - Utility functions (date, phone, validation, permissions)
  lib/session/   - Session hooks and helpers (useSession, getSession, withSession)
  lib/state/     - SharedStateProvider (activity timer, shared data)
  lib/socket/    - Socket.io client setup
  lib/options/   - Dropdown option constants
models/          - TypeScript type definitions (using `export type`)
types/           - Global type declarations and module augmentations
config/          - App configuration utilities
settings/        - Environment-specific JSON config files (not .env)
styles/          - Global SCSS styles and color variables
themes/          - MUI theme (LightTheme) + ThemeRegistry (Emotion SSR)
public/          - Static assets
tests/           - Test files
```

## Architecture Patterns

### Routing
- App Router pages in `app/` — each route has a `page.tsx`
- Dynamic routes: `[userId]`, `[recoverCode]`
- No route groups, parallel routes, or intercepting routes
- API routes in `pages/api/` wrapped with `withSessionRoute()` from iron-session

### Layouts
- Single root layout at `app/layout.tsx` (ThemeRegistry, Providers, Datadog)
- Pages manually import layout wrappers from `layouts/`:
  - `layouts/dashboard/` — Authenticated pages (sidebar nav, top bar)
  - `layouts/PromptLayout/` — Unauthenticated pages (login, recovery, create account)

### Authentication & Sessions
- iron-session stores auth data in encrypted cookies
- Session shape: `{ account, adminAccount, token, user, session }`
- Client-side: `useSession()` hook (SWR-based), `useAuthToken()` for bearer token
- Server-side: `getSession(cookies)` in app directory pages
- API routes: `req.session.auth` via `withSessionRoute`
- Login flow: login -> 2FA verification -> session created

### Data Fetching
- SWR for client-side data with global config in `app/Providers.tsx`
- API modules in `lib/api/` follow consistent pattern:
  ```typescript
  const module = {
    getResource: async (bearerToken, params) => {
      const { data } = await handle(get('/endpoint', { headers: authHeaders(bearerToken), params }));
      return data;
    }
  }
  ```
- All API calls require bearer token from session
- Base URL from `settings/config.json` (`API_HOSTNAME`)

### Environment Configuration
- JSON-based config, NOT .env files
- `settings/config.json` is the active config (copied from environment-specific file during Docker build)
- Environment files: `config.local.json`, `config.staging.json`, `config.production.json`
- Only two actual env vars: `SESSION_SECRET`, `NODE_ENV`

### State Management
- No Redux/Zustand — uses React Context
- `UserContext` — session/auth state
- `AccountSwitchContext` — account switching
- `SharedStateProvider` — activity timer, shared data
- SWR handles server state

## Component Conventions

### Structure
- One folder per component with `index.tsx` as entry point
- Complex components have subdirectories for subcomponents
- Default exports are standard (use `export default ComponentName`)
- All components use `'use client'` directive (App Router client components)
- Props defined as `type ComponentProps = { ... }` with `React.FC<ComponentProps>`

### Import Organization
Follow this order (with comment headers):
```typescript
// React modules
// Node modules
// Material UI components
// Material UI icons
// Components
// Libraries
// Models
// Styles
// Subcomponents
```

### Permissions / Role-Based Access
- `lib/helpers/permission.ts` contains role-checking functions
- Components conditionally render based on user roles via permission helpers

## Styling

### SCSS Modules (preferred for new work)
- All new components and refactored components MUST have a co-located `.scss` module file
- Naming: `ComponentName.module.scss` next to `index.tsx`
- Import as: `import classes from './ComponentName.module.scss'`
- Use `@use '/styles/colorVariables.scss'` for shared color variables
- Usage: `className={classes.someClass}`

### MUI sx Prop
- Used heavily for dynamic/theme-based inline styles
- Acceptable for small, one-off style adjustments
- For complex styling, prefer SCSS modules

### Theme
- Primary color: `#63c5c0` (teal)
- Success color: `#36a900` (green)
- Theme defined in `themes/LightTheme.tsx`
- Custom typography variants: title, detailText, sm

## Code Style

- **Prettier**: semi, singleQuote, printWidth 120
- **ESLint**: extends next/core-web-vitals, @typescript-eslint/recommended, prettier
- **Types**: Use `type` keyword (not `interface`) for model definitions
- **Imports**: No path aliases — use relative imports from project root (e.g., `lib/api/users`)
- Always run `yarn lint` before committing.

## Testing

- Jest with ts-jest preset, jsdom environment
- Test files: `*.test.tsx` or `*.spec.tsx`
- Module aliases in jest config: `@/components`, `@/pages`
- Testing library: @testing-library/react

## Git Workflow

- Main integration branch: `dev`
- Create feature branches off `dev` and PR back to `dev`.

## Docker

- Environment-specific Dockerfiles: `Dockerfile.local`, `Dockerfile.staging`, `Dockerfile.production`
- Each copies the appropriate `settings/config.*.json` -> `settings/config.json`
- Local dev uses `docker-compose.yml` with volume mounts and `yarn watch`
- All environments expose port 3000

## Enforcement Policy (CRITICAL)

**You MUST act as a guardian of this codebase's standards.** If the user requests code or changes that violate any principle in this document, you must:

1. **Stop before writing the violating code.** Do not silently comply.
2. **Clearly identify the violation.** Name the specific rule being broken and reference the relevant section of this document.
3. **Explain why it matters.** Give a brief, practical reason — not a lecture.
4. **Suggest the correct approach.** Show what the compliant version would look like.
5. **Ask for explicit confirmation** before proceeding with the non-compliant approach. Use language like: *"This violates [rule]. The standard approach is [X]. Want me to proceed with the compliant version, or do you want to override this rule?"*

### What triggers enforcement

- Using `interface` instead of `type` for model definitions
- Missing `'use client'` directive on App Router client components
- Inline styles where SCSS modules should be used
- Wrong import ordering (missing comment headers)
- Missing Yup/React Hook Form for form handling
- Direct API calls instead of going through `lib/api/` modules
- Using `.env` files instead of JSON config
- Missing TypeScript types or using `any`
- Components not following folder-per-component convention
- Any other violation of the standards documented above

### User overrides

If the user explicitly acknowledges the violation and confirms they want to proceed anyway, comply — but add a brief `// NOTE: Deviates from [rule] per user request` comment at the point of deviation so it is visible in future reviews.

### Do not be passive

This is not optional guidance. These are the rules of this codebase. A polite pushback that keeps the codebase clean is always preferable to silent compliance that introduces tech debt. The user has opted into this enforcement — respect that by holding the line.
