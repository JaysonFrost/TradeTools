# Trade Clipper Desktop App Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a polished cross-platform Electron desktop application for macOS and Windows that records trade videos via OBS, trims clips by trade lifecycle, uploads videos to YouTube, and sends YouTube links back to Trader Make Money trade journal entries.

**Architecture:** The app uses Electron as the desktop shell, React/Vite/Tailwind for the renderer UI, and a typed Node.js main process for OS integrations, local database, OBS websocket, ffmpeg, exchange adapters, Google OAuth/YouTube upload, and Trader Make Money API sync. Business logic is split into small domain modules so files stay focused and the architecture remains easy to extend.

**Tech Stack:** Electron, TypeScript, React, Vite, Tailwind CSS, Framer Motion, shadcn/radix primitives, SQLite, Drizzle ORM, obs-websocket-js, fluent-ffmpeg or direct ffmpeg CLI, Google OAuth2 + YouTube Data API v3, exchange APIs for Binance/OKX/Bybit, Trader Make Money API, electron-builder.

---

## Product Direction

The application should feel like a premium trading/media operations dashboard, not a basic utility.

Design style:
- dark-first interface;
- purple/indigo accent system;
- Linear-like precision;
- Stripe-like premium gradients and depth;
- Kraken-like crypto trust cues;
- smooth Framer Motion transitions;
- glass panels, soft borders, glowing purple accents;
- clean spacing, no visual clutter.

Primary color direction:

```text
Background:       #08090A
Panel:            #0F1015
Elevated:         #181923
Border:           rgba(255,255,255,0.08)
Text primary:     #F7F8F8
Text secondary:   #A8ADBD
Text muted:       #686B82
Accent purple:    #7132F5
Accent violet:    #8B5CF6
Accent glow:      rgba(113,50,245,0.35)
Success:          #10B981
Danger:           #F43F5E
Warning:          #F59E0B
```

Typography:
- Inter for UI;
- JetBrains Mono for timestamps, technical IDs, paths, logs;
- avoid heavy bold everywhere;
- use 500/600 for headings and 400/500 for UI.

---

## Core User Flows

### Flow 1: First launch setup

1. User opens the app.
2. App shows onboarding wizard:
   - choose recordings/clips folder;
   - connect OBS;
   - choose Replay Buffer duration recommendation;
   - connect exchange accounts;
   - connect Google/YouTube;
   - connect Trader Make Money API.
3. App runs health checks:
   - OBS reachable;
   - Replay Buffer active;
   - ffmpeg installed or bundled;
   - YouTube OAuth valid;
   - journal API reachable.
4. Dashboard opens.

### Flow 2: Automatic trade clip

1. Exchange adapter detects trade open.
2. App creates active trade record.
3. Exchange adapter detects trade close.
4. App saves OBS replay buffer.
5. App trims exact segment with padding.
6. App saves local clip and JSON metadata.
7. If enabled, app uploads clip to YouTube.
8. App gets YouTube URL.
9. App sends URL to Trader Make Money journal entry.
10. Dashboard shows completed trade card.

### Flow 3: Manual approval upload

1. Trade closes and clip is created locally.
2. Clip appears in Review Queue.
3. User previews video.
4. User clicks Upload to YouTube.
5. User optionally edits title/description/visibility.
6. App uploads video.
7. App syncs YouTube URL to Trader Make Money.

### Flow 4: Fully automatic upload

1. User enables Auto Upload.
2. For every completed clip, app uploads in background.
3. Visibility can be:
   - private by default;
   - unlisted;
   - public only if explicitly enabled.
4. App updates journal automatically.

Recommended default: manual approval first, auto-upload optional.

---

## Application Sections

### 1. Dashboard

Shows:
- OBS status;
- active trades;
- recent completed clips;
- upload queue;
- journal sync state;
- storage usage;
- warnings.

Cards:
- Active Trade Card
- Completed Clip Card
- Upload Status Card
- Integration Health Card

### 2. Trades

Shows all detected trades.

Filters:
- exchange;
- market type;
- symbol;
- date;
- clip status;
- upload status;
- journal sync status.

### 3. Review Queue

For clips waiting for manual upload.

Actions:
- preview video;
- open file location;
- upload to YouTube;
- retry trim;
- attach manually to journal;
- delete clip.

### 4. YouTube

Shows:
- connected Google account;
- default visibility;
- default title template;
- default description template;
- upload history;
- quota status if available;
- reconnect button.

### 5. Trader Make Money

Shows:
- API connection state;
- account/workspace info;
- journal matching rules;
- last sync;
- failed sync retries.

Matching strategies:
- by exchange + symbol + entry/exit time;
- by broker trade id/order id if API provides it;
- fallback manual linking.

### 6. Settings

Sections:
- Storage
- OBS
- Exchanges
- Video trimming
- YouTube upload
- Trader Make Money
- Privacy/security
- Logs/diagnostics

---

## Cross-Platform Requirements

### macOS

- app packaged as `.dmg`;
- support Apple Silicon and Intel if possible;
- app data path: `~/Library/Application Support/Trade Clipper`;
- logs: `~/Library/Logs/Trade Clipper`;
- can optionally start on login.

### Windows

- app packaged as `.exe` installer;
- app data path: `%APPDATA%/Trade Clipper`;
- logs: `%LOCALAPPDATA%/Trade Clipper/logs`;
- can optionally start on login.

### OBS

OBS must be running separately.

Use OBS websocket:
- host default: `127.0.0.1`;
- port default: `4455`;
- password stored securely.

### ffmpeg

Preferred:
- bundle ffmpeg binaries per platform;
- fallback to system ffmpeg if available;
- health check shows which ffmpeg is being used.

---

## Security Model

Store secrets in OS keychain, not plain `.env`:

macOS:
- Keychain via `keytar`.

Windows:
- Credential Manager via `keytar`.

Secrets:
- exchange API keys;
- OBS password;
- Google OAuth refresh token;
- Trader Make Money API key.

Database should only store references and non-sensitive metadata.

API key recommendations:
- exchange keys read-only;
- withdrawals disabled;
- trading disabled where possible;
- IP whitelist if possible.

YouTube defaults:
- first implementation should upload as `private` or `unlisted`;
- public upload requires explicit user opt-in.

---

## YouTube Integration

Use YouTube Data API v3.

Required OAuth scope:

```text
https://www.googleapis.com/auth/youtube.upload
```

Optional scope if later editing metadata/listing videos:

```text
https://www.googleapis.com/auth/youtube
```

Upload metadata template:

Title:

```text
{{symbol}} {{side}} trade — {{entryTime}} — {{exchange}}
```

Description:

```text
Trade clip generated by Trade Clipper

Exchange: {{exchange}}
Market: {{marketType}}
Symbol: {{symbol}}
Side: {{side}}
Entry: {{entryTime}}
Exit: {{exitTime}}
Duration: {{duration}}
PnL: {{pnl}}

Journal: {{journalUrl}}
```

Tags:

```text
trading, {{symbol}}, {{exchange}}, {{marketType}}, trade journal
```

Privacy options:
- private;
- unlisted;
- public.

Default: `private` or `unlisted`.

Upload modes:
- Manual: user reviews and clicks upload.
- Automatic: app uploads right after clip creation.
- Hybrid: auto-upload only for selected exchanges/symbols.

---

## Trader Make Money Integration

API details are pending.

Required abstraction now:

```ts
interface TradeJournalClient {
  testConnection(): Promise<JournalConnectionStatus>
  findTrade(input: FindJournalTradeInput): Promise<JournalTradeMatch[]>
  attachVideo(input: AttachVideoInput): Promise<AttachVideoResult>
}
```

Expected operations:
- authenticate with API key/token;
- search trade by exchange/symbol/time/order id;
- attach external video URL to trade description or media field;
- optionally create a comment/note with YouTube link;
- retry failed syncs.

Do not hardcode Trader Make Money API until docs/keys are provided. Build an adapter stub and contract tests first.

---

## Proposed File Structure

```text
TradeClipper/
  package.json
  electron-builder.yml
  tsconfig.json
  vite.config.ts
  tailwind.config.ts
  src/
    main/
      app.ts
      ipc.ts
      windows/
        createMainWindow.ts
      services/
        obs/
          obsClient.ts
          obsHealth.ts
        video/
          ffmpeg.ts
          trimPlanner.ts
          clipWriter.ts
        exchanges/
          exchangeTypes.ts
          exchangeManager.ts
          binanceAdapter.ts
          bybitAdapter.ts
          okxAdapter.ts
        youtube/
          googleOAuth.ts
          youtubeUploader.ts
          youtubeTemplates.ts
        journal/
          journalTypes.ts
          traderMakeMoneyClient.ts
          journalSyncService.ts
        trades/
          tradeStateMachine.ts
          tradeLifecycleService.ts
        storage/
          database.ts
          schema.ts
          repositories.ts
        security/
          secrets.ts
        diagnostics/
          logger.ts
          healthChecks.ts
    preload/
      index.ts
      api.ts
    renderer/
      main.tsx
      App.tsx
      routes/
        Dashboard.tsx
        Trades.tsx
        ReviewQueue.tsx
        YouTubeSettings.tsx
        JournalSettings.tsx
        Settings.tsx
      components/
        layout/
          AppShell.tsx
          Sidebar.tsx
          TopBar.tsx
        ui/
          Button.tsx
          Card.tsx
          Badge.tsx
          Input.tsx
          Switch.tsx
          Modal.tsx
        trade/
          ActiveTradeCard.tsx
          ClipCard.tsx
          TradeTimeline.tsx
        integrations/
          IntegrationStatusCard.tsx
          ConnectionWizard.tsx
      styles/
        globals.css
        tokens.css
      lib/
        api.ts
        formatters.ts
        motion.ts
  tests/
    unit/
      tradeStateMachine.test.ts
      trimPlanner.test.ts
      youtubeTemplates.test.ts
      journalMatching.test.ts
```

Principle:
- no giant files;
- UI components stay small;
- services own business logic;
- renderer never talks directly to filesystem/API keys;
- all privileged actions go through Electron IPC;
- main process validates every IPC request.

---

## IPC Boundaries

Renderer can request:

```ts
window.tradeClipper.obs.getStatus()
window.tradeClipper.obs.saveReplayTest()
window.tradeClipper.trades.list()
window.tradeClipper.clips.preview(id)
window.tradeClipper.youtube.connect()
window.tradeClipper.youtube.uploadClip(id, options)
window.tradeClipper.journal.testConnection()
window.tradeClipper.settings.get()
window.tradeClipper.settings.update(patch)
```

Renderer cannot:
- read raw API secrets;
- call arbitrary filesystem paths;
- execute arbitrary shell commands;
- upload without explicit IPC path.

---

## Database Model

Tables:

```text
settings
exchange_accounts
trades
executions
clips
youtube_uploads
journal_links
sync_jobs
app_events
```

Important statuses:

```text
clip.status: pending | trimming | ready | failed
youtube.status: not_uploaded | queued | uploading | uploaded | failed
journal.status: not_synced | queued | synced | failed
trade.status: open | closed | ignored
```

---

## Build Phases

### Phase 1: Desktop shell and design system

Deliver:
- Electron + React + Vite app;
- purple dark UI shell;
- sidebar/topbar;
- dashboard mock data;
- smooth transitions;
- settings screens.

Success criteria:
- app launches on macOS;
- renderer looks premium;
- files are modular;
- no exchange/OBS yet.

### Phase 2: OBS + local clip pipeline

Deliver:
- OBS connection screen;
- Replay Buffer save test;
- ffmpeg trim planner;
- local clip output;
- simulated trade open/close.

Success criteria:
- simulated trade creates a real trimmed clip.

### Phase 3: Trade detection adapters

Deliver:
- Binance adapter;
- Bybit adapter;
- OKX adapter;
- spot/futures abstractions;
- active trade dashboard.

Success criteria:
- dry-run mode sees account events;
- live mode creates clips on closed trades.

### Phase 4: YouTube OAuth and upload

Deliver:
- Google OAuth desktop flow;
- token storage in keychain;
- manual upload from Review Queue;
- upload progress;
- uploaded URL saved in DB.

Success criteria:
- selected clip uploads to YouTube as private/unlisted;
- YouTube URL is shown in app.

### Phase 5: Trader Make Money sync

Deliver after API docs are provided:
- API client;
- connection test;
- trade matching;
- attach YouTube link to video description/comment/media field;
- retry queue.

Success criteria:
- uploaded clip URL appears in the correct Trader Make Money trade entry.

### Phase 6: Packaging for macOS and Windows

Deliver:
- `.dmg` for macOS;
- `.exe` installer for Windows;
- bundled ffmpeg;
- auto-start option;
- app update strategy if desired.

---

## Initial Implementation Tasks

### Task 1: Create Electron project

**Objective:** Create a clean Electron + React + TypeScript foundation.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/main/app.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`

**Commands:**

```bash
cd /Users/igorarnautov/TradeClipper
npm create electron-vite@latest desktop -- --template react-ts
cd desktop
npm install
npm run dev
```

Expected:
- Electron window opens;
- React UI renders.

### Task 2: Install UI dependencies

**Objective:** Add styling, animation, icons, and primitives.

**Commands:**

```bash
npm install tailwindcss @tailwindcss/vite framer-motion lucide-react clsx tailwind-merge class-variance-authority @radix-ui/react-dialog @radix-ui/react-switch @radix-ui/react-tooltip
```

Expected:
- dependencies install successfully.

### Task 3: Add design tokens

**Objective:** Centralize the purple dark visual language.

**Files:**
- Create: `src/renderer/styles/tokens.css`
- Modify: `src/renderer/styles/globals.css`

Tokens should include:
- surfaces;
- text colors;
- accent colors;
- border radii;
- shadows/glows;
- motion durations.

### Task 4: Build AppShell

**Objective:** Create main layout with sidebar and topbar.

**Files:**
- Create: `src/renderer/components/layout/AppShell.tsx`
- Create: `src/renderer/components/layout/Sidebar.tsx`
- Create: `src/renderer/components/layout/TopBar.tsx`

Design:
- dark background;
- translucent sidebar;
- purple active nav indicator;
- animated route transitions.

### Task 5: Build dashboard mock

**Objective:** Build a beautiful UI before connecting real data.

**Files:**
- Create: `src/renderer/routes/Dashboard.tsx`
- Create: `src/renderer/components/trade/ActiveTradeCard.tsx`
- Create: `src/renderer/components/trade/ClipCard.tsx`
- Create: `src/renderer/components/integrations/IntegrationStatusCard.tsx`

Mock cards:
- OBS connected;
- Binance futures active;
- YouTube not connected;
- Trader Make Money waiting for API key;
- recent BTCUSDT clip ready.

### Task 6: Add main process service skeletons

**Objective:** Create clean service modules before implementation.

**Files:**
- Create service files under `src/main/services/...` as listed above.

Each service should expose typed interfaces and no UI code.

### Task 7: Add OBS connection

**Objective:** Connect Electron main process to OBS websocket.

**Dependencies:**

```bash
npm install obs-websocket-js
```

Functions:
- connect;
- getStatus;
- saveReplayBuffer;
- listen for replay saved event if available.

### Task 8: Add ffmpeg trim planner

**Objective:** Make video timing deterministic and testable.

Functions:
- calculate replay start time;
- calculate clip offsets;
- clamp offsets;
- generate ffmpeg command.

Add tests before implementation.

### Task 9: Add YouTube OAuth shell

**Objective:** Prepare Google account connection.

Dependencies:

```bash
npm install googleapis keytar
```

Requirements:
- use desktop OAuth flow;
- store refresh token in keychain;
- request YouTube upload scope;
- show connected account in UI.

### Task 10: Add Trader Make Money placeholder integration

**Objective:** Build UI/API abstraction before docs arrive.

Files:
- `traderMakeMoneyClient.ts`
- `JournalSettings.tsx`

Behavior:
- user can paste API key;
- key stored in keychain;
- test connection button exists but uses stub until API docs arrive.

---

## Open Questions

Need answers later:

1. Trader Make Money API docs:
   - auth method;
   - base URL;
   - how to search/list trades;
   - how to update video description/media/link;
   - rate limits.

2. YouTube upload default:
   - private, unlisted, or public?
   - recommended default: unlisted or private.

3. Upload mode:
   - manual review first;
   - automatic later;
   - or automatic from day one?

4. Should the app bundle ffmpeg or require system install?
   - recommended: bundle for Windows, allow bundled/system on macOS.

5. Should there be a cloud/backend account?
   - recommended: no backend for MVP; local app only.

---

## Strong Recommendation

Build this as a desktop-first local app with no backend in MVP.

Reason:
- OBS is local;
- exchange keys are sensitive;
- YouTube OAuth can be desktop OAuth;
- Trader Make Money can be called directly from local app;
- fewer servers and fewer security risks.

Default behavior:
- detect trades automatically;
- create clips automatically;
- upload manually at first;
- sync to Trader Make Money manually or automatically after YouTube upload succeeds;
- add full automatic mode once the pipeline is trusted.
