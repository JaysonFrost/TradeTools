# Recording Widget Above Taskbar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the plan task-by-task.

**Goal:** Keep the recording widget above the Windows taskbar and restore its position and visibility whenever the dashboard button is clicked.

**Architecture:** Use the existing compact overlay window, but calculate its pinned position above the work area instead of inside taskbar bounds. The show command will always recalculate bounds, reassert topmost z-order, and then show the window without stealing focus.

**Tech Stack:** Electron BrowserWindow, React IPC, Vitest, TypeScript.

---

### Task 1: Add failing placement and show-path contracts

**Files:**
- Modify: `tests/unit/recordingWidgetPlacement.test.ts`
- Modify: `tests/unit/appLifecycle.test.ts`

**Step 1: Write the failing tests**

- Expect both pinned and unpinned placement to be above the work area.
- Require the show path to call `repositionRecordingWidgetWindow()` before showing an existing widget.

**Step 2: Run targeted tests**

Run: `npx vitest run tests/unit/recordingWidgetPlacement.test.ts tests/unit/appLifecycle.test.ts`

Expected: FAIL because pinned placement is currently inside taskbar and the show path does not reposition first.

### Task 2: Implement above-taskbar placement and restore behavior

**Files:**
- Modify: `src/main/recordingWidgetPlacement.ts`
- Modify: `src/main/app.ts`

**Step 1: Implement placement**

- Keep the compact taskbar-sized height, but place the widget at `workAreaBottom - height - edgeGap` for every state.

**Step 2: Implement show recovery**

- Reposition an existing widget before `showInactive()` or `show()`.
- Reassert `pop-up-menu` topmost level and `moveTop()` before the show call.

**Step 3: Run targeted tests**

Run: `npx vitest run tests/unit/recordingWidgetPlacement.test.ts tests/unit/appLifecycle.test.ts`

Expected: PASS.

### Task 3: Validate the complete change

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add an Unreleased changelog note**

- Document that the widget now stays above taskbar and can be restored by the dashboard button.

**Step 2: Run validation**

Run: `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`

Expected: all tests, typecheck, build, and whitespace checks pass.
