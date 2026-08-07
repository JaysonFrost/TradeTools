# Recording Recovery, FFprobe, and Multi-Trade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore reliable continuous recording and clip rendering, including bundled ffprobe, independent clips for overlapping symbols, correct per-trade padding, and recovery when terminal windows change.

**Architecture:** Keep the existing rolling-segment pipeline and terminal watcher. Make recorder health follow the configured segment duration, reconcile capture sessions per source instead of tearing down every recorder, persist the final MediaRecorder chunk, and replay provider state once when recording changes from stopped to active. Preserve independent trade keys and add narrow cross-source duplicate suppression.

**Tech Stack:** Electron, TypeScript, React, MediaRecorder, FFmpeg/ffprobe, Vitest

---

### Task 1: Restore bundled ffprobe

**Files:**
- Modify if needed: `package-lock.json`
- Test: `tests/unit/mediaBinaries.test.ts`

**Steps:**
1. Run the existing media-binary test and retain the failing bundled-ffprobe assertion as the regression.
2. Run `npm install` so declared installer packages exist in `node_modules`.
3. Verify `require('@ffprobe-installer/ffprobe').path` is an existing absolute path and run that binary with `-version`.
4. Re-run the media-binary test.

### Task 2: Stop false recorder death and lost final chunks

**Files:**
- Modify: `src/main/services/recording/windowRecorderService.ts`
- Modify: `src/main/app.ts`
- Modify: `src/renderer/components/recording/WindowRecorderController.tsx`
- Modify: `src/renderer/routes/Dashboard.tsx`
- Test: `tests/unit/windowRecorderService.test.ts`
- Test: `tests/unit/appLifecycle.test.ts`
- Test: `tests/unit/dashboardLayout.test.ts`

**Steps:**
1. Add a failing test proving a 10-second browser segment remains active after 11 seconds and becomes stale only after the configured safety window.
2. Derive browser freshness from `segmentSeconds` and use it only for browser-recorder health.
3. Add a failing lifecycle assertion proving an active browser fallback is not restarted merely because fallback mode is in use.
4. Change ensure handling to reconcile sources without a full teardown and fetch current settings before reconciliation.
5. Add a failing controller assertion for persistence of the final `dataavailable` blob during cleanup.
6. Persist queued final chunks even after the React effect is disposed.

### Task 3: Reconcile terminal windows independently

**Files:**
- Modify: `src/renderer/components/recording/WindowRecorderController.tsx`
- Modify: `src/main/app.ts`
- Modify if required: `src/shared/types.ts`
- Test: `tests/unit/dashboardLayout.test.ts`
- Test: `tests/unit/appLifecycle.test.ts`

**Steps:**
1. Add failing tests or source-contract assertions for terminal auto-discovery, source deduplication, and no full restart when a second terminal appears.
2. Match stale terminal targets by terminal family as well as current source id, and deduplicate resolved sources.
3. Prefer the window whose title contains the trade ticker when several windows from one terminal are open.
4. Replace stale logical targets without changing the primary/save target unnecessarily.
5. Recover a dead capture track by reconciling only that source; never restart a MediaRecorder on a dead stream.
6. Verify two live terminal sources can append segments concurrently.

### Task 4: Preserve trades across recording startup and terminal restarts

**Files:**
- Modify: `src/main/app.ts`
- Modify: `src/main/services/trades/terminalTradeRecorder.ts`
- Test: `tests/unit/terminalTradeRecorder.test.ts`

**Steps:**
1. Add a failing test for a provider initialized while recording is stopped, followed by recording activation, an already-open Tiger position, and its close.
2. On the first stopped-to-active transition, reset provider cursors for a one-time current-position replay and clamp reconstructed entry time to the real recording start.
3. Keep the logical recording boundary stable during internal recorder reconciliation.
4. Add equivalent safe reconstruction for Vataga's latest non-closed positions.
5. Verify the reconstructed trade has `entryTimeMs < exitTimeMs` and is queued once.

### Task 5: Guarantee independent overlapping clips and suppress duplicate providers

**Files:**
- Modify: `src/main/services/trades/terminalTradeRecorder.ts`
- Test: `tests/unit/terminalTradeRecorder.test.ts`
- Test: `tests/unit/windowRecorderService.test.ts`

**Steps:**
1. Add a failing regression with overlapping BTC and ETH opens, reverse-order closes, distinct targets, and distinct entry/exit boundaries.
2. Verify two closed trades are queued with their own target and timing; retain the earliest active protection boundary while either remains open.
3. Add tests for the same real trade reported by Tiger and Vataga within one second, different symbols at the same time, and same-symbol trades outside the tolerance.
4. Add a short-lived cross-source fingerprint keyed by normalized exchange, symbol, side, and close boundaries; never deduplicate same-source or different-symbol trades.
5. Verify replay export selects each trade's own interval plus configured before/after padding.

### Task 6: Validate and restart the real application

**Files:**
- Verify: application logs and `.tradetools-cache/segments`

**Steps:**
1. Stop only the exact TradeTools development process tree after resolving command lines and parent pids.
2. Run targeted Vitest files, `npm run typecheck`, `npm run build`, the full test suite, and `git diff --check`.
3. Start TradeTools again with its npm parent hidden.
4. Verify the installed ffprobe executes, fresh recording segments accumulate, more than one terminal source is represented when open, and no immediate ensure/restart loop appears in logs.
5. Report any pre-existing unrelated test failures separately from regressions introduced by this fix.
