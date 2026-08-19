# Recording Widget Taskbar Contrast Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the compact recording widget readable and place it inside the bottom Windows taskbar while preserving pinning behavior.

**Architecture:** Keep placement calculations in `src/main/recordingWidgetPlacement.ts`; use the existing renderer theme tokens and explicit high-contrast icon classes in `RecordingWidget.tsx`. Add source-contract and placement regressions before implementation so the widget remains compact and taskbar-aware.

**Tech Stack:** Electron BrowserWindow, React, Tailwind utility classes, Vitest, TypeScript.

---

### Task 1: Add failing placement and icon-contrast contracts

**Files:**
- Modify: `tests/unit/recordingWidgetPlacement.test.ts`
- Modify: `tests/unit/dashboardLayout.test.ts`

**Step 1: Write the failing tests**

- Expect a 48px bottom taskbar to contain the 44px widget, centered vertically at `y = 1034` for a 1080px display.
- Expect a 36px bottom taskbar to contain the 36px widget at `y = 1044`.
- Keep the hidden/vertical-taskbar fallback above the work area.
- Require the widget source to define a high-contrast icon class and apply it to the compact icon buttons.

**Step 2: Run the targeted tests**

Run: `npx vitest run tests/unit/recordingWidgetPlacement.test.ts tests/unit/dashboardLayout.test.ts`

Expected: FAIL because placement is currently above the taskbar and the widget has no shared high-contrast icon class.

### Task 2: Implement taskbar placement and icon contrast

**Files:**
- Modify: `src/main/recordingWidgetPlacement.ts`
- Modify: `src/renderer/components/recording/RecordingWidget.tsx`

**Step 1: Implement minimal placement change**

- For a detected bottom taskbar, set `y` to `workAreaBottom + floor((bottomTaskbarHeight - height) / 2)`.
- Preserve the existing fallback above the work area when the taskbar is hidden or vertical.
- Keep the existing width, edge reserve, compact height, and always-on-top argument.

**Step 2: Implement minimal contrast change**

- Add a shared icon class with an explicit bright foreground (`text-[#f7fbff]`) and a visible border/background.
- Use the shared class on all five compact buttons, retaining status-specific accent colors for recording, save feedback, and pin state.

**Step 3: Run targeted tests**

Run: `npx vitest run tests/unit/recordingWidgetPlacement.test.ts tests/unit/dashboardLayout.test.ts`

Expected: PASS.

### Task 3: Validate and document the patch

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add an Unreleased entry**

- Document the taskbar placement and icon contrast fixes without changing the published version until validation completes.

**Step 2: Run validation**

Run: `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`

Expected: all tests, typecheck, build, and whitespace checks pass.

**Step 3: Review the final diff**

- Confirm only widget placement, widget icon styling, tests, plan, and changelog changed.
- Confirm no unrelated release artifacts or runtime processes are modified.
