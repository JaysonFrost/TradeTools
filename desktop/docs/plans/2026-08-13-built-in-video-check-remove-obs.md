# Built-in Video Check and OBS Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use Ponytail full mode and implement task-by-task.

**Goal:** Make «Проверить видео» validate the built-in recorder without creating a clip, and remove OBS connection as a supported recording path.

**Architecture:** Keep one recording backend, the existing built-in window/screen recorder. Delete OBS-only UI, IPC, secrets, service wiring, dependency, and settings branches; migrate legacy `mode: obs` settings to `window`. The health check will query/control the built-in recorder and show a deterministic status in the Dashboard.

**Tech Stack:** Electron, React, TypeScript, Vitest.

---

### Task 1: Lock the intended behavior with source-contract and settings tests

**Files:**
- Modify: `tests/unit/dashboardLayout.test.ts`
- Modify: `tests/unit/appLifecycle.test.ts`
- Modify: `tests/unit/settings.test.ts`

1. Assert that OBS controls, labels, IPC and service wiring are absent.
2. Assert that the video check uses only the built-in recording API and reports its result.
3. Assert legacy OBS mode normalizes to window mode.
4. Run focused tests and confirm the new assertions fail before implementation.

### Task 2: Remove OBS from renderer and preload

**Files:**
- Modify: `src/renderer/routes/Dashboard.tsx`
- Modify: `src/renderer/components/layout/TopBar.tsx`
- Modify: `src/renderer/components/settings/ObsSettingsPanel.tsx`
- Modify: `src/renderer/components/setup/SetupWizard.tsx`
- Modify: `src/renderer/components/setup/setupWizardSteps.ts`
- Modify: `src/preload/index.ts`

1. Rename the recording settings panel to a backend-neutral/built-in name.
2. Remove mode selection, OBS credentials, OBS replay folder and OBS-specific wizard steps/copy.
3. Make «Проверить видео» call only the built-in recorder status/start path and display an accessible result.
4. Remove renderer OBS state and preload API.

### Task 3: Remove OBS from main and settings

**Files:**
- Modify: `src/main/app.ts`
- Modify: `src/main/services/settings/settings.ts`
- Modify: `src/main/services/settings/settingsStore.ts`
- Modify: `src/main/services/security/secretStore.ts`
- Modify: `src/main/services/trades/tradeClipPipeline.ts`
- Modify: `src/main/services/video/trimPlanner.ts`
- Delete: `src/main/services/obs/obsService.ts`
- Delete: `src/main/services/obs/obsReplayService.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

1. Remove OBS service construction, IPC handlers, password storage and dependency.
2. Collapse recording mode to built-in window mode and migrate legacy settings.
3. Collapse replay/render branches to the built-in path while preserving clip validation and cleanup.
4. Remove now-obsolete OBS tests.

### Task 4: Verify

1. Run focused recording, settings, lifecycle and dashboard tests.
2. Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
3. Do not launch Electron or any screen-control/UI automation.
