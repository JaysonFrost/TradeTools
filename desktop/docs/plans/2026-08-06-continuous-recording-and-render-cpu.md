# Continuous Recording and Bounded Render CPU Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent missing or frozen video frames in Chromium recordings and keep FFmpeg clip rendering from consuming all available CPU cores.

**Architecture:** Keep one MediaRecorder active for a bounded 60 second session and emit small `timeslice` chunks without restarting the encoder every two seconds. Store those chunks as one logical WebM session, rebuild the complete session before FFmpeg reads it, and rotate only at the session boundary. Validate that replay segments continuously cover the requested wall-clock interval. Use the selected hardware encoder and apply a shared half-core, maximum two-thread budget to FFmpeg decoding and encoding used for clip rendering, while leaving live capture unchanged.

**Tech Stack:** Electron, React, TypeScript, MediaRecorder, Node.js, FFmpeg, Vitest.

---

### Task 1: Add regression coverage for recording continuity

**Files:**
- Modify: `tests/unit/windowRecorderService.test.ts`
- Modify: `src/main/services/recording/windowRecorderService.ts`

- [x] Add a test proving that an internal hole in otherwise matching segments is rejected.
- [x] Add source-level assertions for a continuous `MediaRecorder.start(timeslice)` session and session reconstruction.
- [x] Run the focused test and confirm that the new expectations fail before implementation.

### Task 2: Replace two-second recorder restarts with bounded continuous sessions

**Files:**
- Modify: `src/renderer/components/recording/WindowRecorderController.tsx`
- Modify: `src/main/services/recording/windowRecorderService.ts`
- Test: `tests/unit/windowRecorderService.test.ts`

- [x] Emit numbered chunks from one MediaRecorder for 60 seconds.
- [x] Retain pruned browser-session prefixes only for reconstruction, without making them visible again if the buffer setting grows.
- [x] Rebuild each selected browser session into one temporary WebM because individual timeslice blobs are not guaranteed to be playable.
- [x] Reject incomplete sequence data with a readable error and clean temporary session files after export.
- [x] Run focused recorder tests.

### Task 3: Bound FFmpeg render CPU usage

**Files:**
- Modify: `src/main/services/video/ffmpegCommand.ts`
- Modify: `src/main/services/recording/windowRecorderService.ts`
- Modify: `tests/unit/ffmpegCommand.test.ts`
- Modify: `tests/unit/simulatedTradePipeline.test.ts`
- Modify: `tests/unit/tradeClipPipeline.test.ts`

- [x] Calculate a render budget equal to half the available logical cores, with a maximum of two and a minimum of one.
- [x] Apply the budget to both FFmpeg input decoding and output encoding during clip renders.
- [x] Keep native background capture arguments unchanged.
- [x] Add deterministic unit coverage for thread-budget calculation and command placement.

### Task 4: Verify the combined fix

**Files:**
- Test: `tests/unit/windowRecorderService.test.ts`
- Test: `tests/unit/ffmpegCommand.test.ts`
- Test: `tests/unit/tradeClipPipeline.test.ts`
- Test: `tests/unit/simulatedTradePipeline.test.ts`

- [x] Run focused Vitest suites.
- [x] Run TypeScript typecheck.
- [x] Run the production build.
- [x] Review the final diff and preserve unrelated TMM and UI work.
