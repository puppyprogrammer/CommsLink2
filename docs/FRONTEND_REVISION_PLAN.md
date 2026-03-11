# CommsLink2 Frontend Revision Plan

## Current State

The v2 frontend has basic scaffolding: login, register, chat (rooms + text), forum, profile (email/password only), and admin dashboard. But it's missing the core identity of CommsLink — the voice communication features, settings panel, translation, premium subscription flow, branding, and polish.

## V1 Features Missing from V2

### Priority 1: Voice & Audio (Core Identity)

#### 1A. Speech Recognition (Mic Input)
**What v1 does:** Click "START MIC" -> Web Speech API captures speech -> transcript auto-sent as chat message. Language-aware (maps en/es/de/he/lo to locales). Continuous mode with auto-restart.

**V2 work needed:**
- The mic button exists but only appends transcript to input field — needs to auto-send
- Add language-aware locale mapping for recognition
- Add continuous recognition mode with visual recording indicator
- Add START/STOP MIC toggle with red pulsing animation

**Files to modify:**
- `app/chat/page.tsx` — wire up recognition to auto-send, add language awareness
- `styles/` — add recording animation CSS

#### 1B. Browser TTS (Free Voice Output)
**What v1 does:** Every received message is spoken aloud using Web Speech Synthesis API. Three voice avatars: Male, Female, Robot. Audio queue prevents overlap. Volume slider controls loudness. "Hear My Own Voice" toggle.

**V2 work needed:**
- Create `lib/helpers/tts.ts` — browser TTS engine with queue, voice selection, volume
- Wire into chat message receive handler
- Add voice avatar selection (Male/Female/Robot)
- Add volume slider
- Add "Hear My Own Voice" checkbox
- Respect user preferences from profile

**New files:**
- `lib/helpers/tts.ts` — TTS engine
- `lib/helpers/speechRecognition.ts` — extract recognition logic from chat page

#### 1C. Premium ElevenLabs TTS
**What v1 does:** Premium users generate audio server-side via ElevenLabs. Audio sent as base64 in chat messages. All receivers can play it (no key needed on their end). Voice list fetched from ElevenLabs API.

**V2 work needed:**
- Wire `lib/api/voice.ts` (already exists) into the send flow
- When user has premium voice selected, call `/api/v1/voice/generate` before sending message
- Attach base64 audio to socket message
- On receive, play audio blob instead of browser TTS
- Populate premium voice dropdown from `/api/v1/voice/list`

**Files to modify:**
- `app/chat/page.tsx` — send flow with audio generation
- `lib/api/voice.ts` — already exists, just needs wiring

### Priority 2: Settings Panel

#### 2A. Voice & Communication Settings
**What v1 does:** Right panel with settings that auto-save on change:
- Voice Avatar dropdown (Male/Female/Robot + premium voices)
- "Test Voice" button
- Volume slider
- Input Language dropdown (en, es, de, he, lo)
- Output Language dropdown (en, es, de, he, lo)
- "Use Premium Voices ($5/mo)" checkbox (triggers Stripe if not premium)
- "Hear My Own Voice" checkbox

**V2 work needed:**
- Create a Settings panel component (collapsible right sidebar or integrated into chat page)
- All settings save to backend via `POST /api/v1/profile/update`
- Load saved preferences on login from session user object
- Store preferences in React context for cross-component access

**New files:**
- `components/SettingsPanel/index.tsx` — full settings UI
- `components/SettingsPanel/SettingsPanel.module.scss`
- `lib/state/PreferencesContext.tsx` — user preferences context

#### 2B. Account Modal
**What v1 does:** Modal with two tabs:
- **Profile tab:** Email, voice avatar, premium toggle, password change
- **Subscription tab:** Premium status (green/red dot), expiry date, "Manage Subscription" button

**V2 work needed:**
- Replace or augment the current `/profile` page with a modal accessible from the header
- Add Subscription tab with Stripe portal link
- Show premium status indicator in header

**Files to modify:**
- `layouts/dashboard/index.tsx` — add Account button to header
- `app/profile/page.tsx` — enhance with voice settings + subscription tab

### Priority 3: Translation

**What v1 does:** Client-side translation via MyMemory API (free, no key). Input translation: non-English -> English before sending (original preserved). Output translation: English -> user's language on receive. Display: "Original text (translated text)".

**V2 work needed:**
- Create `lib/helpers/translation.ts` — MyMemory API client
- Wire into send flow: translate before sending, include `original` field
- Wire into receive flow: translate received text to output language
- Display format: show both original and translated text

**New files:**
- `lib/helpers/translation.ts` — translation adapter

**Files to modify:**
- `app/chat/page.tsx` — send/receive with translation
- `models/chat.ts` — add `original` field to ChatMessage

### Priority 4: Stripe Premium Flow

**What v1 does:** Checking "Use Premium Voices" when not premium triggers Stripe Checkout redirect. Webhook handles subscription lifecycle. Customer portal for managing subscription.

**V2 work needed:**
- Wire the premium checkbox in settings to trigger checkout
- Add Stripe checkout redirect flow
- Add subscription management page/modal
- Show premium status badge in UI
- `lib/api/payment.ts` already exists — just needs frontend integration

**Files to modify:**
- `components/SettingsPanel/index.tsx` — premium checkbox triggers checkout
- `app/profile/page.tsx` — subscription management section

### Priority 5: Branding & Polish

#### 5A. Logo & Favicon
**What v1 has:** SVG logo with three concentric glowing arcs (cyan, green, magenta) with blur filters. No favicon in production but should have one.

**V2 work needed:**
- Port the SVG logo to `public/logo.svg`
- Generate favicon set (favicon.ico, apple-touch-icon, etc.)
- Add to `app/layout.tsx` metadata
- Use logo in PromptLayout (login/register) and dashboard header

**New files:**
- `public/logo.svg`
- `public/favicon.ico`
- `public/apple-touch-icon.png`

#### 5B. Cyberpunk Theme Refinement
**What v1 has:** Scanline overlay effect, neon glow borders, grid background pattern, pulsing animations.

**V2 work needed:**
- The dark theme is already close but lacks the signature cyberpunk effects
- Add subtle scanline overlay (CSS)
- Add neon glow to primary elements (borders, active states)
- Add grid background pattern to login/register pages

**Files to modify:**
- `styles/globals.scss` — scanline overlay, grid background
- `themes/LightTheme.tsx` — refine glow effects on components

#### 5C. Connection Monitor
**What v1 does:** Polls server every 30s, shows ONLINE/OFFLINE indicator.

**V2 work needed:**
- Create connection status component using socket connection state
- Show green/red dot in header

**New files:**
- `components/ConnectionStatus/index.tsx`

#### 5D. Mobile Responsive Navigation
**What v1 does:** Bottom nav bar on mobile (<=768px) with Chat/Rooms/Settings tabs. Only one panel visible at a time.

**V2 work needed:**
- Add responsive breakpoint to dashboard layout
- Replace permanent drawer with toggleable drawer on mobile
- Add bottom navigation tabs

**Files to modify:**
- `layouts/dashboard/index.tsx` — responsive drawer
- `layouts/dashboard/Dashboard.module.scss` — mobile styles
- `app/chat/Chat.module.scss` — mobile layout for chat panels

### Priority 6: Version & About Pages

#### 6A. Version Footer
**What v1 does:** Footer shows current version number as clickable link. Version history page shows table of all versions.

**V2 work needed:**
- Add version display to dashboard footer
- Create version history page

**Files to modify:**
- `layouts/dashboard/index.tsx` — add footer
- New: `app/versions/page.tsx`

#### 6B. About Page
**What v1 has:** Static page describing CommsLink features.

**V2 work needed:**
- `app/about/page.tsx` — informational page

---

## Implementation Order

### Phase 1: Settings & Preferences (Foundation)
1. Create PreferencesContext
2. Build SettingsPanel component
3. Wire settings to profile API (auto-save)
4. Load preferences on login

### Phase 2: Voice Output (TTS)
1. Build browser TTS engine (queue, voice avatars, volume)
2. Wire into chat receive handler
3. Add "Hear My Own Voice" logic
4. Integrate volume slider from settings

### Phase 3: Voice Input (Speech Recognition)
1. Extract recognition into reusable helper
2. Add language-aware locale mapping
3. Wire auto-send on final transcript
4. Add recording indicator animation

### Phase 4: Translation
1. Build MyMemory translation adapter
2. Wire send flow (translate -> send with original)
3. Wire receive flow (translate received text)
4. Update message display for dual-language

### Phase 5: Premium & Stripe
1. Wire premium checkbox to Stripe checkout
2. Add subscription status display
3. Add "Manage Subscription" with portal link
4. Gate premium voice list behind subscription

### Phase 6: Premium Voice (ElevenLabs)
1. Populate premium voice dropdown from API
2. Generate audio on send for premium users
3. Attach base64 audio to socket messages
4. Play audio blobs on receive

### Phase 7: Branding & Polish
1. Port SVG logo + generate favicon
2. Add cyberpunk CSS effects (scanline, glow, grid)
3. Add connection status indicator
4. Add mobile responsive navigation
5. Add version footer + history page
6. Add about page

---

## New Files Summary

```
components/
  SettingsPanel/
    index.tsx
    SettingsPanel.module.scss
  ConnectionStatus/
    index.tsx

lib/
  helpers/
    tts.ts
    speechRecognition.ts
    translation.ts
  state/
    PreferencesContext.tsx

app/
  versions/
    page.tsx
  about/
    page.tsx

public/
  logo.svg
  favicon.ico
```

## Modified Files Summary

```
app/chat/page.tsx          — major: settings panel, TTS, recognition, translation, audio
app/chat/Chat.module.scss  — settings panel layout, mobile responsive
app/profile/page.tsx       — voice settings, subscription tab
app/layout.tsx             — favicon metadata
layouts/dashboard/         — account modal, connection status, mobile nav, footer
models/chat.ts             — add original/audio fields
styles/globals.scss        — cyberpunk effects
themes/LightTheme.tsx      — glow refinements
```
