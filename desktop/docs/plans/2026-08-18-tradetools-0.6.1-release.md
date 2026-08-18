# TradeTools 0.6.1 Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the compact taskbar recording-widget improvements as TradeTools 0.6.1 with race-safe buffer saving and complete cross-platform updater assets.

**Architecture:** Keep `WindowRecorderController` as the only browser-capture owner. Route widget buttons and the global buffer shortcut through main-process IPC and one shared in-flight promise, then publish from the existing tag-triggered GitHub Actions workflow.

**Tech Stack:** Electron, TypeScript, React, Vitest, electron-vite, electron-builder, GitHub Actions.

---

### Task 1: Close the buffer-save shutdown race

**Files:**
- Modify: `src/main/app.ts`
- Modify: `tests/unit/appLifecycle.test.ts`

**Step 1: Write the failing source-contract assertion**

Require `saveLatestRecordingBuffer()` to re-check `recordingControlShuttingDown` immediately before it creates manual render jobs.

**Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/unit/appLifecycle.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Expected: the new shutdown-boundary assertion fails.

**Step 3: Add the minimal guard**

After the async settings load and before `enqueueManualBufferRender(...)`, throw `Приложение завершает работу` when `recordingControlShuttingDown` is true. Keep `Promise.allSettled(...)` so the shared in-flight guard stays active until every monitor job settles.

**Step 4: Run the focused test and typecheck**

Run:

```powershell
npx vitest run tests/unit/appLifecycle.test.ts --pool=forks --poolOptions.forks.singleFork=true
npm run typecheck
```

Expected: both commands pass.

### Task 2: Prepare version and changelog

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `../CHANGELOG.md`

**Step 1: Add the 0.6.1 changelog section**

Document the taskbar-height widget, pin control, one-click replay buffer save, `Ctrl/Cmd+Shift+F10`, multi-monitor coalescing, shortcut availability, placement recovery, and relevant race fixes.

**Step 2: Synchronize package metadata**

Run:

```powershell
npm version 0.6.1 --no-git-tag-version
npm install --package-lock-only
```

Expected: both package files report `0.6.1`, with no dependency drift.

### Task 3: Validate and package

**Files:**
- Test: `tests/unit/appLifecycle.test.ts`
- Test: `tests/unit/dashboardLayout.test.ts`
- Test: `tests/unit/recordingWidgetPlacement.test.ts`
- Test: `tests/unit/recordingWidgetState.test.ts`
- Test: `tests/unit/tradeClipPipeline.test.ts`

**Step 1: Run all tests**

```powershell
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
```

Expected: all test files pass.

**Step 2: Run typecheck, production build, and diff checks**

```powershell
npm run typecheck
npm run build
git diff --check
```

Expected: all commands pass.

**Step 3: Build the Windows updater payload**

```powershell
npm run dist:win
```

If `keytar.node` is locked by the running dev Electron process, run:

```powershell
npx electron-builder --win nsis --x64 --publish never --config.npmRebuild=false
```

Expected: `TradeTools-0.6.1-win-x64.exe`, its `.blockmap`, and `latest.yml` are complete and internally reference 0.6.1.

### Task 4: Publish the release source

**Files:**
- Stage every intended source, test, plan, version, and changelog file.

**Step 1: Audit and commit**

```powershell
git status --short
git diff --check
git add <intended-files>
git commit -m "release: 0.6.1"
```

**Step 2: Tag and push**

```powershell
git tag -a v0.6.1 -m "TradeTools 0.6.1"
git push origin main
git push origin v0.6.1
```

Expected: `origin/main`, local `main`, and `v0.6.1` resolve to the same release commit.

### Task 5: Verify GitHub release publication

**Files:**
- Inspect: `.github/workflows/*release*.yml`

**Step 1: Monitor the tag workflow**

Use `gh run list`, `gh run view`, and `gh run watch` until every required Windows and macOS job succeeds. Retry only proven transient infrastructure failures.

**Step 2: Audit assets and public downloads**

Confirm the GitHub release contains the Windows installer and blockmap, both macOS architectures, `latest.yml`, `latest-mac.yml`, and `SHA256SUMS.txt`. Probe the public updater manifests and compare the published checksums with downloaded assets.

Expected: all updater files return HTTP 200 and name version 0.6.1.
