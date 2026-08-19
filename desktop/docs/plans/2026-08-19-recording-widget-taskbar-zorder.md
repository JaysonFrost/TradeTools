# Recording Widget Taskbar Z-Order Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the pinned compact recording widget above the Windows taskbar after taskbar clicks and other z-order changes.

**Architecture:** Reuse the existing BrowserWindow overlay instead of embedding into Explorer. Add one main-process helper that reapplies the Windows `pop-up-menu` topmost level and moves the widget to the top without focusing it, then call it after creation, repositioning, showing, pinning, and widget blur.

**Tech Stack:** Electron BrowserWindow, Windows topmost z-order, Vitest source-contract tests, TypeScript.

---

### Task 1: Add the z-order regression contract

**Files:**
- Modify: `tests/unit/appLifecycle.test.ts`

**Step 1: Write the failing assertions**

- Require a dedicated `keepRecordingWidgetOnTop` helper.
- Require the helper to call `setAlwaysOnTop(true, 'pop-up-menu')` and `moveTop()` without focusing the window.
- Require the helper to be wired to widget blur, show, and reposition paths.

**Step 2: Run the targeted test**

Run: `npx vitest run tests/unit/appLifecycle.test.ts`

Expected: FAIL because the helper and z-order reassertion do not exist yet.

### Task 2: Reassert the pinned widget z-order

**Files:**
- Modify: `src/main/app.ts`

**Step 1: Implement the helper**

- Return early when the widget is missing or destroyed.
- Return early when the widget is intentionally unpinned.
- Reapply the Windows `pop-up-menu` level, which is above the taskbar, and call `moveTop()`.

**Step 2: Wire lifecycle paths**

- Call the helper after widget creation, `setBounds`, `showInactive`, and pin toggles.
- Register a `blur` listener so clicking the taskbar reasserts the overlay without stealing focus.

**Step 3: Run the targeted tests**

Run: `npx vitest run tests/unit/appLifecycle.test.ts`

Expected: PASS.

### Task 3: Validate the complete change

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add an Unreleased changelog entry**

- Document that pinned widget z-order is restored after taskbar interaction.

**Step 2: Run validation**

Run: `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`

Expected: all tests, typecheck, build, and whitespace checks pass.
