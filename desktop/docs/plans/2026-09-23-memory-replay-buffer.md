# Memory Replay Buffer Implementation Plan

**Goal:** Keep encoded rolling recording data in bounded RAM and write video files only for exports or protected recordings that exceed the memory budget.

**Architecture:** Preserve Chromium window capture and hardware-capable FFmpeg screen capture. Window capture uses one continuous WebCodecs H.264/AAC encoder and emits keyframe-aligned fragmented MP4. Native screen capture emits fragmented MP4 over stdout. A shared byte budget evicts complete unprotected units or spills protected ones. Export readers hold references until their input files have been written. Capture queues and fragment parsing are bounded.

**Tech Stack:** Electron 44, TypeScript, WebCodecs, Mediabunny, FFmpeg, Node buffers/streams, Vitest.

1. Add bounded fragmented-MP4 parsing with real FFmpeg fixture coverage. Keep native screen capture hardware selection and frame rate unchanged.
2. Replace rolling browser/native segment files with memory payloads, byte/time pruning, protected spill, and export-time materialization. Preserve replay coverage checks and concurrent export protection. Add status counters for the memory budget and usage.
3. Bound pending renderer chunks across sources, shorten independently decodable browser sessions, and expose the memory budget in recording settings.
4. Test zero background video-file writes, bounded retention across sources, session boundaries, protected spill, concurrent exports and cleanup. Run the complete unit suite and production build once after the final code changes; repeat only checks affected by a concrete failure or subsequent change.
5. Document the implementation and limits. Keep the existing capture-discovery leak fix. Do not replace or restart the installed application or publish a release as part of this source change.

**Window encoder implementation:** Done. The window fallback now emits independent H.264/AAC fMP4 keyframe groups through WebCodecs; there is no MediaRecorder instance in that route. Full tests passed 445/445 and production build completed. Electron did not expose H.264 hardware encoding at 2560×1600 in the live capability probe, so CPU load on the native preset still needs the user's live test. The dev app is running for that check. This implementation has not had an hours-long soak.

**Follow-up outcome:** Electron 44.4.5 now exposes native-resolution hardware H.264; Windows VideoEncode counters confirm use in the running app. A separate unbounded React development performance timeline was identified and cleared through a development-only observer. MP4 timestamp rebasing was corrected after a real buffer export caught nonzero fragment origins. The final 60-second clip decoded all 1,800 frames. See `docs/diagnostics/2026-09-23-recording-memory.md` for the bounded memory observations and preserved pre-restart recordings.
