# Async Window Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Return Electron desktop capture sources immediately while Windows PID and bounds metadata are loaded without blocking the main process.

**Architecture:** Cache the base Electron sources first, then schedule one coalesced background PowerShell process that obtains all WinAPI metadata in one invocation. Keep per-window metadata behind a TTL and merge completed enrichment into the existing capture-source cache for later matching calls.

**Tech Stack:** Electron, TypeScript, Node child processes, Vitest source-contract tests.

---

### Task 1: Protect the non-blocking source-discovery contract

**Files:**
- Modify: `tests/unit/appLifecycle.test.ts`

**Step 1: Write source-contract tests**

Assert that source discovery caches and returns base sources without awaiting PowerShell, uses a single-flight enrichment promise, and contains no `spawnSync('powershell.exe'...)` in the capture metadata section.

**Step 2: Run the targeted test and verify it fails**

Run: `npm test -- --run tests/unit/appLifecycle.test.ts`

Expected: FAIL because PID and bounds are still loaded by two synchronous PowerShell calls.

### Task 2: Move WinAPI metadata enrichment to the background

**Files:**
- Modify: `src/main/app.ts`

**Step 1: Combine the WinAPI query**

Use one hidden asynchronous PowerShell process to return PID and bounds for all sanitized window handles. Do not query foreground state on the trade-event path.

**Step 2: Add bounded caching and coalescing**

Keep a per-window metadata TTL, a retry throttle, a pending-ID set, and one in-flight promise so the five-second source poll cannot start duplicate compiler processes.

**Step 3: Return base sources first**

Populate `windowCaptureSourcesCache`, schedule enrichment without awaiting it, and merge completed metadata into the current cache for later symbol, process, display, and cursor matching.

### Task 3: Validate the change

**Files:**
- Test: `tests/unit/appLifecycle.test.ts`

**Step 1: Run targeted tests**

Run: `npm test -- --run tests/unit/appLifecycle.test.ts`

Expected: PASS.

**Step 2: Run TypeScript checks**

Run: `npm run typecheck`

Expected: PASS.

**Step 3: Check patch whitespace**

Run: `git diff --check -- src/main/app.ts tests/unit/appLifecycle.test.ts docs/plans/2026-08-07-async-window-metadata.md`

Expected: no output.
