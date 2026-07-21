# Video List Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users select clips individually, in common calendar periods, or by a chosen date; sort them and delete only the selected video files.

**Architecture:** Keep file deletion on the existing safe single-clip IPC path. Put calendar selection, sorting, and date grouping in a small renderer helper, then render the controls and selected-state management in the existing dashboard queue section.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Tailwind CSS, lucide-react.

---

### Task 1: Cover calendar grouping and sorting

**Files:**
- Create: `tests/unit/clipList.test.ts`
- Create: `src/renderer/lib/clipList.ts`

**Step 1: Write the failing test**

Create representative clips across a Monday, Tuesday, and the previous week. Assert that day, week, month, and custom-date selection return the intended metadata paths, and that grouping preserves named date sections with requested sorting.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clipList.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: FAIL because `clipList.ts` does not exist.

**Step 3: Write minimal implementation**

Use local calendar dates, `Intl.DateTimeFormat('ru-RU')`, and stable tie breakers. Do not add a date-picker or sorting dependency.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/clipList.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: PASS.

### Task 2: Add selected-clip actions to the queue

**Files:**
- Modify: `src/renderer/routes/Dashboard.tsx`
- Modify: `src/renderer/components/trade/ClipCard.tsx`

**Step 1: Write the failing source-contract test**

Extend `tests/unit/dashboardLayout.test.ts` to require individual selection, day/week/month/custom-date controls, selected deletion, date grouping, and name/duration/date sorting.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboardLayout.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: FAIL because the controls are absent.

**Step 3: Write minimal implementation**

Add a queue-section component state for selected paths and sort. Make each card selectable. The destructive action confirms once, calls the existing `clips.deleteFile` for each selected clip, keeps failed selections, and reports the result.

**Step 4: Run targeted checks**

Run: `npx vitest run tests/unit/clipList.test.ts tests/unit/dashboardLayout.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: PASS.

### Task 3: Verify the application

**Files:**
- Verify: `src/renderer/routes/Dashboard.tsx`
- Verify: `src/renderer/components/trade/ClipCard.tsx`

**Step 1: Run type validation**

Run: `npm run typecheck`

Expected: PASS.

**Step 2: Build production bundles**

Run: `npm run build`

Expected: PASS.
