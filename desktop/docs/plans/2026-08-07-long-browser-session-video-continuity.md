# Long Browser Session Video Continuity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve every video frame when a built-in browser recording crosses a 60-second MediaRecorder session boundary, and reject any ready clip whose video track is shorter than the trade plus padding.

**Architecture:** Keep the existing 10-second chunks and 60-second MediaRecorder rotation. Reconstruct each WebM session as today. Browser sessions must be opened as separate FFmpeg inputs and joined through the concat filter by media type because Chromium can change WebM track order between rotations. Normalize each input to its absolute wall-clock interval, fill small gaps with the final frame and silence, and trim overlaps from later sessions. Native segments keep an FFconcat manifest with explicit wall-clock duration. Independently validate the resulting video-stream duration against the requested trade interval, rather than trusting the already shortened replay duration.

**Tech Stack:** Electron, TypeScript, MediaRecorder WebM, FFmpeg concat demuxer, ffprobe, Vitest.

---

### Task 1: Lock the concat timeline with a failing unit test

**Files:**
- Modify: `tests/unit/windowRecorderService.test.ts`
- Modify: `src/main/services/recording/windowRecorderService.ts`

**Step 1: Write the failing test**

Add a pure regression test for two reconstructed browser sessions. The expected manifest must contain the FFconcat header and a duration after every file:

```ts
expect(buildReplayConcatManifest([
  { path: 'C:/cache/session-1.webm', startedAtMs: 1_000, endedAtMs: 61_010 },
  { path: 'C:/cache/session-2.webm', startedAtMs: 61_011, endedAtMs: 121_014 }
])).toBe([
  'ffconcat version 1.0',
  "file 'C:/cache/session-1.webm'",
  'duration 60.010',
  "file 'C:/cache/session-2.webm'",
  'duration 60.003',
  ''
].join('\n'))
```

Also cover an apostrophe in a path and reject a non-positive wall-clock duration.

**Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/unit/windowRecorderService.test.ts`

Expected: FAIL because `buildReplayConcatManifest` does not exist and the current list contains only `file` directives.

**Step 3: Add the smallest manifest helper**

Export a helper that:

```ts
export const buildReplayConcatManifest = (sessionFiles: ReplaySessionFile[]): string => {
  const lines = ['ffconcat version 1.0']
  for (const sessionFile of sessionFiles) {
    const durationSeconds = (sessionFile.endedAtMs - sessionFile.startedAtMs) / 1000
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Сессия встроенной записи имеет некорректную длительность')
    }
    lines.push(`file '${escapeConcatPath(sessionFile.path)}'`)
    lines.push(`duration ${formatFfmpegSeconds(durationSeconds)}`)
  }
  return `${lines.join('\n')}\n`
}
```

Use this helper for native segment concatenation instead of the file-only concat list. Keep the existing single-pass H.264 render.

**Step 4: Run the targeted test**

Run: `npm test -- --run tests/unit/windowRecorderService.test.ts`

Expected: PASS.

### Task 2: Concatenate browser sessions by stream type

**Files:**
- Modify: `src/main/services/recording/windowRecorderService.ts`
- Modify: `tests/unit/windowRecorderService.test.ts`

**Step 1: Write the failing regression test**

Build a concat filter for two sessions where the first WebM exposes streams as video then audio and the second exposes audio then video. The graph must select `v:0` and `a:0` from each input independently, reset timestamps, concatenate, then trim the requested interval.

**Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/unit/windowRecorderService.test.ts`

Expected: FAIL because browser sessions currently use the concat demuxer, which joins streams by index.

**Step 3: Add the browser multi-input concat filter**

Pass every reconstructed browser session as its own `-i`. Probe whether each input really contains audio. Build `setpts` and `asetpts` branches selected by stream type, normalize gaps and overlaps against absolute timestamps, run `concat=n=N:v=1:a=1` only when all inputs contain audio or `a=0` otherwise, and trim video and audio to the same requested wall-clock interval. Map `[vout]` and `[aout]` into the existing single-pass output profile.

**Step 4: Run the targeted test**

Run: `npm test -- --run tests/unit/windowRecorderService.test.ts`

Expected: PASS.

### Task 3: Recover a muted browser video track

**Files:**
- Modify: `src/renderer/components/recording/WindowRecorderController.tsx`
- Modify: `tests/unit/windowRecorderService.test.ts`

**Step 1: Write the failing regression test**

Export a small predicate for a usable browser video track. A track is usable only while `readyState` is `live` and `muted` is false. Assert that both the normal reconciliation path and the delayed `onmute` path use it.

**Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/unit/windowRecorderService.test.ts`

Expected: FAIL because the current liveness check ignores `track.muted` and the delayed mute handler asks for reconciliation without invalidating the broken session.

**Step 3: Restart a persistently muted capture**

Use the predicate from `streamIsLive`. After the existing two-second mute delay, call `markSessionDead(session)` when the video track is still muted or ended. This removes readiness, stops the audio-only recorder, and reacquires the same terminal source.

**Step 4: Run the targeted test**

Run: `npm test -- --run tests/unit/windowRecorderService.test.ts`

Expected: PASS.

### Task 4: Reject a truncated ready clip

**Files:**
- Modify: `src/main/services/trades/tradeClipPipeline.ts`
- Modify: `tests/unit/tradeClipPipeline.test.ts`

**Step 1: Write the failing regression test**

Create a `readyClip` trade matching the incident:

```ts
const trade = {
  ...createSimulatedClosedTrade(exitTimeMs),
  entryTimeMs: 1_786_057_767_524,
  exitTimeMs: 1_786_057_835_795
}
```

Use padding 3 seconds before and 2 seconds after. Return `51.5` seconds from `getVideoDetails`. Expect `createClipForClosedTrade` to reject with both the actual duration and the expected `73.27` seconds, and expect no final MP4 or metadata item.

**Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/unit/tradeClipPipeline.test.ts`

Expected: FAIL because the current ready-clip branch compares 51.5 seconds with itself.

**Step 3: Validate against the requested interval**

Calculate:

```ts
const expectedReadyClipDurationSeconds =
  (targetTrade.exitTimeMs - targetTrade.entryTimeMs) / 1000 +
  settings.clip.paddingBeforeSeconds +
  settings.clip.paddingAfterSeconds
```

For built-in ready clips, pass that value to `minimumAcceptableOutputDuration`. Keep the actual probed duration in metadata, but do not publish or enqueue a file that is shorter than the requested interval within the existing tolerance.

**Step 4: Run the targeted test**

Run: `npm test -- --run tests/unit/tradeClipPipeline.test.ts`

Expected: PASS.

### Task 5: Verify a real cross-session recording

**Files:**
- Verify: `%USERPROFILE%/Videos/Торговля/Сделки/.tradetools-cache/segments`
- Verify: `%LOCALAPPDATA%/Temp/tradetools-long-session-*`

**Step 1: Build two full WebM sessions from consecutive 10-second chunks**

Use the first EBML header `1A45DFA3` as the start of each session. Preserve all chunks in order.

**Step 2: Render a 20-second interval crossing the 60-second boundary**

Use the application FFmpeg profile and generated browser concat filter. Start at 50 seconds and render 20 seconds.

Expected: no `could not seek`, timestamp, or VP9 decoder warnings.

**Step 3: Probe the result**

Run ffprobe for stream duration and frame count, then compute frame hashes for both 10-second halves.

Expected: video and audio are both about 20 seconds, video contains 600 frames at 30 FPS, and the second half contains changing frames rather than a repeated last frame.

### Task 6: Run the complete verification suite

**Files:**
- Verify: repository working tree

**Step 1: Run focused tests**

Run: `npm test -- --run tests/unit/windowRecorderService.test.ts tests/unit/tradeClipPipeline.test.ts`

Expected: PASS.

**Step 2: Run all tests**

Run: `npm test -- --run`

Expected: PASS.

**Step 3: Run static and production checks**

Run: `npm run typecheck`

Run: `npm run build`

Run: `git diff --check`

Expected: all commands succeed. Existing unrelated user changes remain untouched. Do not create a commit because this working tree already contains the user's larger unfinished TradeTools change set.

### Task 7: Close export failure edge cases

**Files:**
- Modify: `src/main/services/recording/windowRecorderService.ts`
- Modify: `tests/unit/windowRecorderService.test.ts`

**Step 1: Clean failed exports**

Keep reconstructed session paths before rendering begins. Remove reconstructed WebM files, concat manifests, and partial MP4 outputs after an error or cancellation in both trade replay and free recording exports.

**Step 2: Cover mixed audio topology**

Probe each browser session through bundled ffprobe. Never reference a missing audio stream in the concat filter. Preserve video export even when an older session has no audio track.

**Step 3: Run regression tests**

Run the full Vitest suite, typecheck, production build, real cross-boundary FFmpeg render, and live post-restart segment probe.
