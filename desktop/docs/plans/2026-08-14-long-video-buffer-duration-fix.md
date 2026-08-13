# Long Video Buffer Duration Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make "Save last buffer" export exactly one replay-buffer interval instead of applying trade padding a second time and creating an oversized video assembled from extra sessions.

**Architecture:** Keep the existing segmented recorder and verified FFmpeg session assembly. Treat the manual buffer's synthetic trade interval as the complete requested range, so its export receives zero additional before/after padding. Ordinary trade clips continue using configured padding unchanged.

**Tech Stack:** Electron, TypeScript, built-in recorder, FFmpeg, Vitest.

---

### Task 1: Reproduce the doubled manual-buffer interval

**Files:**
- Modify: `tests/unit/tradeClipPipeline.test.ts`

**Step 1: Extend the manual-buffer test**

Use the long preset values: a 600-second replay buffer, 600 seconds before, and 120 seconds after. Capture the `saveReplayBuffer` input.

**Step 2: Assert the intended export range**

Verify that the synthetic trade spans exactly 600 seconds and the settings passed to the recorder contain zero extra padding. The existing implementation must fail this assertion because it forwards 600/120.

**Step 3: Run the focused test**

Run: `npm test -- --run tests/unit/tradeClipPipeline.test.ts`

Expected before the fix: FAIL on the forwarded clip padding.

### Task 2: Stop applying trade padding twice

**Files:**
- Modify: `src/main/services/trades/tradeClipPipeline.ts`

**Step 1: Build manual export settings**

Copy the current settings and override only `clip.paddingBeforeSeconds` and `clip.paddingAfterSeconds` with zero.

**Step 2: Export the existing synthetic interval**

Keep `entryTimeMs = requestedAtMs - replayBufferSeconds * 1000` and `exitTimeMs = requestedAtMs`, then call the normal clip pipeline with the manual export settings.

**Step 3: Run focused tests**

Run: `npm test -- --run tests/unit/tradeClipPipeline.test.ts tests/unit/windowRecorderService.test.ts`

Expected: PASS.

### Task 3: Verify the complete application

**Files:**
- Verify: repository working tree

**Step 1: Run all unit tests**

Run: `npm test -- --run`

Expected: PASS.

**Step 2: Run static and production checks**

Run: `npm run typecheck`

Run: `npm run build`

Run: `git diff --check`

Expected: all checks pass. Do not launch the application or modify unrelated worktree changes.
