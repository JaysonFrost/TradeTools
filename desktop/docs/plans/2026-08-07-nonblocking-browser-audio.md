# Nonblocking Browser Audio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Start each browser MediaRecorder as soon as its desktop video stream is ready while optional system and microphone audio connect later without replacing the recorder audio track.

**Architecture:** Build one Web Audio destination per recorder session before MediaRecorder starts, so the recording stream owns a stable audio track that initially carries silence. Launch system-audio and microphone capture independently after recorder startup, connect successful streams to that session's destination, and stop late streams if their session has already ended.

**Tech Stack:** React, TypeScript, Electron desktop capture, MediaRecorder, Web Audio API, Vitest.

---

### Task 1: Protect asynchronous audio behavior

**Files:**
- Modify: `tests/unit/windowRecorderService.test.ts`
- Create: `tests/unit/asyncAudioCapture.test.ts`

**Step 1: Add a source-order test**

Assert that MediaRecorder starts before either optional audio capture is launched, and that no optional capture is awaited on the video startup path.

**Step 2: Add behavioral tests**

Use deferred fake streams to verify system audio and microphone start independently, connect only after resolution, do not reject the video path on an audio failure, and stop a stream that resolves after session shutdown.

**Step 3: Run tests to verify the old implementation fails**

Run: `npm test -- --run tests/unit/asyncAudioCapture.test.ts tests/unit/windowRecorderService.test.ts`

Expected: FAIL because optional audio currently blocks MediaRecorder startup.

### Task 2: Start video before optional audio

**Files:**
- Modify: `src/renderer/components/recording/WindowRecorderController.tsx`

**Step 1: Create a stable session audio destination**

When either audio option is enabled, create a per-session AudioContext and MediaStreamDestination immediately and put its one audio track into the MediaRecorder stream.

**Step 2: Launch optional inputs after recorder startup**

Start system-audio and microphone promises without awaiting them. Connect each successful stream to the existing destination and report its own failure without stopping video.

**Step 3: Preserve cleanup and isolation**

Disconnect source nodes, close only that session's AudioContext, stop captured tracks, and stop any stream that resolves after the session becomes inactive.

### Task 3: Validate the change

**Files:**
- Test: `tests/unit/asyncAudioCapture.test.ts`
- Test: `tests/unit/windowRecorderService.test.ts`

**Step 1: Run targeted tests**

Run: `npm test -- --run tests/unit/asyncAudioCapture.test.ts tests/unit/windowRecorderService.test.ts`

Expected: PASS.

**Step 2: Run TypeScript checks**

Run: `npm run typecheck`

Expected: PASS.

**Step 3: Check patch whitespace**

Run: `git diff --check -- src/renderer/components/recording/WindowRecorderController.tsx tests/unit/asyncAudioCapture.test.ts tests/unit/windowRecorderService.test.ts docs/plans/2026-08-07-nonblocking-browser-audio.md`

Expected: no output.
