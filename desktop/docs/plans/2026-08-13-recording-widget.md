# Recording Widget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a small always-on-top recording controller with live status and a global recording toggle hotkey.

**Architecture:** Keep the existing `WindowRecorderController` as the only browser-capture owner in the main renderer. Move the desired enabled state to the Electron main process, broadcast it to both renderers, and make the widget a pure status/control client. Separate user intent from recorder-engine cleanup so controller remounts cannot disable recording.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, Vitest.

---

### Task 1: Lock the control contract with tests

**Files:**
- Create: `tests/unit/recordingWidgetState.test.ts`
- Modify: `tests/unit/appLifecycle.test.ts`
- Modify: `tests/unit/dashboardLayout.test.ts`

1. Test widget view-state derivation for stopped, recording, waiting, protected, busy and error states.
2. Add source-contract tests for the dedicated always-on-top window, explicit window identity, global shortcut lifecycle and control IPC.
3. Add source-contract tests for main-renderer synchronization and the widget route.
4. Run the focused tests before implementation.

### Task 2: Add main-owned recording control state

**Files:**
- Create: `src/shared/recordingControl.ts`
- Modify: `src/main/app.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/components/recording/WindowRecorderController.tsx`

1. Add a shared serializable control status.
2. Add main-process get/set/status-report IPC and broadcast changes to all renderer windows.
3. Reject stop while a terminal trade, free recording or protected clip job is active.
4. Keep controller cleanup on a separate internal engine-stop IPC.
5. Register `CommandOrControl+Shift+F9` after Electron is ready and unregister it on quit.

### Task 3: Add the compact pinned widget

**Files:**
- Create: `src/renderer/components/recording/RecordingWidget.tsx`
- Create: `src/renderer/lib/recordingWidgetState.ts`
- Modify: `src/renderer/main.tsx`
- Modify: `src/main/app.ts`

1. Create one fixed-size frameless `BrowserWindow`, always on top and excluded from taskbar/capture where supported.
2. Load the existing renderer entry with `?window=recording-widget`.
3. Render status, hotkey label, toggle button, open-main button and close-widget button.
4. Keep capture ownership in the main renderer and synchronize Dashboard from main state.

### Task 4: Verify behavior

**Files:**
- Modify only if verification finds defects.

1. Run focused Vitest tests.
2. Run the full Vitest suite in a single fork.
3. Run `npm run typecheck` and `npm run build`.
4. Leave manual UI verification to the user, as requested.
5. Review `git diff` and preserve unrelated work.
