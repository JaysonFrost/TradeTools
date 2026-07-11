# Video Cache Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep built-in recording's temporary files in the configured clip folder, prune them reliably, and add a safe cache cleanup action for users.

**Architecture:** The recorder resolves a hidden cache root from the current `clip.outputDir`, with separate `segments` and `replays` subfolders. The main process owns cleanup and restarts native recording when appropriate; the renderer only calls a typed IPC method and displays the result.

**Tech Stack:** Electron main/preload IPC, TypeScript, React, Node `fs/promises`, Vitest.

## Global Constraints

- Final clips remain under `clip.outputDir` and are never deleted by cache cleanup.
- Legacy `<appDataDir>/window-recording` is removable only through the explicit cleanup action.
- Cleanup must not run during active trade/free-recording protection.
- Do not add dependencies or unrelated refactors.

---

### Task 1: Move and bound the built-in recording cache

**Files:**
- Modify: `src/main/services/recording/windowRecorderService.ts`
- Test: `tests/unit/windowRecorderService.test.ts`

**Interfaces:**
- Produce `VideoCacheClearResult` and `WindowRecorderService.clearCache(settings)`.
- Resolve cache roots as `join(settings.clip.outputDir, '.tradetools-cache')` in production; retain the injected app-data fallback only for existing isolated service fixtures.

- [ ] **Step 1: Write failing tests**

Add tests that append a browser segment and assert it is created under `settings.clip.outputDir/.tradetools-cache/segments`, that stale segments are pruned while a recent segment remains, that `clearCache` removes the configured cache and legacy `appDataDir/window-recording`, and that an unrelated final `.mp4` in `outputDir` remains.

- [ ] **Step 2: Run the focused test file and verify the expected failure**

Run: `npm test -- tests/unit/windowRecorderService.test.ts`

Expected: FAIL because the service currently writes to `appDataDir/window-recording` and has no `clearCache` method.

- [ ] **Step 3: Implement the minimal service change**

Replace fixed `segmentsDir`/`replaysDir` paths with settings-derived cache paths, store each native recorder's active segments directory, use that path when scanning and pruning, add replay-file age pruning, and add `clearCache` that stops native recorders, rejects protected recordings, clears in-memory segments, removes the generated cache roots and legacy root, then returns removed-file information.

- [ ] **Step 4: Run the focused tests and verify green**

Run: `npm test -- tests/unit/windowRecorderService.test.ts`

Expected: PASS with no failures.

- [ ] **Step 5: Commit the isolated service change**

Run: `git add src/main/services/recording/windowRecorderService.ts tests/unit/windowRecorderService.test.ts && git commit -m "fix: keep built-in recording cache in output folder"`

### Task 2: Expose cleanup through Electron and settings UI

**Files:**
- Modify: `src/main/app.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/components/settings/ObsSettingsPanel.tsx`
- Test: `tests/unit/dashboardLayout.test.ts`

**Interfaces:**
- IPC channel: `recording:clear-cache`.
- Renderer API: `window.tradeTools.recording.clearCache(): Promise<VideoCacheClearResult>`.

- [ ] **Step 1: Write failing bridge/UI assertions**

Assert that the settings panel contains `Очистить кэш видео`, the preload invokes `recording:clear-cache`, and the main process registers the matching handler.

- [ ] **Step 2: Run the focused layout test and verify the expected failure**

Run: `npm test -- tests/unit/dashboardLayout.test.ts`

Expected: FAIL because the button and IPC bridge do not exist yet.

- [ ] **Step 3: Implement the minimal bridge and UI**

Register the main handler, restart native recording after cleanup only when background recording is enabled, add the preload method, and add a confirmation-protected settings button with busy state and a message explaining that final clips are preserved.

- [ ] **Step 4: Run the focused layout test and verify green**

Run: `npm test -- tests/unit/dashboardLayout.test.ts`

Expected: PASS with no failures.

- [ ] **Step 5: Commit the bridge/UI change**

Run: `git add src/main/app.ts src/preload/index.ts src/renderer/components/settings/ObsSettingsPanel.tsx tests/unit/dashboardLayout.test.ts && git commit -m "feat: add video cache cleanup action"`

### Task 3: Full verification

**Files:**
- Verify: `src/main/services/recording/windowRecorderService.ts`
- Verify: `src/main/app.ts`
- Verify: `src/preload/index.ts`
- Verify: `src/renderer/components/settings/ObsSettingsPanel.tsx`

- [ ] **Step 1: Run the complete unit suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript verification**

Run: `npm run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit code 0 and Electron output is generated.
