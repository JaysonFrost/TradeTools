# TMM Trade Links Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Match each closed terminal trade with its TraderMake.Money journal record and retain a direct journal link beside the corresponding review clip.

**Architecture:** Store the TMM API key in the operating-system credential vault. A small main-process client fetches same-symbol records for the relevant calendar days and accepts only the closest record whose open and close times both fit the tolerance. The resulting stable journal URL is written to the existing per-clip metadata JSON and surfaced through the existing clip queue bridge.

**Tech Stack:** Electron, TypeScript, Node fetch, keytar, Vitest, React.

---

### Task 1: Secure TMM configuration and matcher

**Files:**
- Modify: `src/main/services/security/secretStore.ts`
- Create: `src/main/services/trades/tmmTradeMatcher.ts`
- Test: `tests/unit/tmmTradeMatcher.test.ts`

1. Add a keytar account for the TMM API key and expose read/write/clear methods.
2. Write a failing matcher test covering calendar-day query construction, millisecond/second timestamps, tolerance, and generated TMM journal URL.
3. Implement the minimum `GET /api/v2/trades/` matcher with `API-KEY`, symbol/date filtering, 120-second tolerance, and a network timeout.
4. Run the focused matcher and secret-store tests.

### Task 2: Persist the match with each clip

**Files:**
- Modify: `src/main/services/trades/tradeClipPipeline.ts`
- Modify: `src/main/app.ts`
- Test: `tests/unit/tradeClipPipeline.test.ts`

1. Extend persisted queue metadata with the optional TMM URL.
2. Start matching alongside clip rendering, without letting TMM failures prevent clip creation.
3. Await the lookup only before metadata write, so a completed clip is listed with its URL immediately when TMM has the record.
4. Test metadata round-tripping across a pipeline reload.

### Task 3: Settings and queue action

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/components/settings/ObsSettingsPanel.tsx`
- Modify: `src/renderer/components/trade/ClipCard.tsx`
- Test: `tests/unit/appLifecycle.test.ts`

1. Add minimal trusted IPC for TMM key status and storing/removing the key.
2. Add a password field in settings so the key never enters `settings.json`.
3. Add a visible action on a linked clip that opens the exact journal trade in the default browser.
4. Run focused tests, typecheck, build, and the Windows-safe full Vitest run.
