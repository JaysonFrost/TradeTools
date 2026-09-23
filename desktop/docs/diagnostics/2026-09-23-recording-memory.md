# TradeTools recording slowdown: Windows capture discovery leak

Observed on 2026-09-23, approximately 09:19-09:25 Moscow time.

## Live installed application

- Installed TradeTools 0.7.1, main PID 20728, started 2026-09-22 17:56:41.
- Main process: 24.12 GiB private committed memory, 8.19 GiB resident working set, 15,958 threads, about 101,465 handles.
- Computer: 31.81 GiB physical RAM, 1.36 GiB available at the first sample.
- Native handle inventory included 16,723 thread handles, 15,922 timers and 35,023 events. Thread handles and live thread counts are different measurements.
- Recording was already disabled by the time it was inspected. The video cache contained no files, but the main process retained the resources above. No recording toggle, cache deletion, application restart or proxy change was performed during the diagnosis.
- The other TradeTools processes were small: approximately 27-115 MiB private memory each. No running FFmpeg or FFprobe process was found.
- The current-run application log contained a recovered proxy startup timeout and a successful clip export at 08:49. It contained no resource telemetry explaining the accumulation.

## Reproduction and correction

The installed ASAR and local source both called `desktopCapturer.getSources` with `types: ['window', 'screen']`, `thumbnailSize: { width: 1, height: 1 }`, and `fetchWindowIcons: false`. Recording source discovery runs every five seconds. The returned thumbnail is never consumed by TradeTools.

Two temporary, isolated Electron 31.7.7 processes were run without a BrowserWindow or any MediaRecorder. Each repeatedly listed sources, using the same disabled WGC features as TradeTools, and exited automatically. The only changed option was thumbnail size. Windows process counters were sampled outside Electron.

Representative samples after completed calls (MiB rounded):

| Thumbnail size | Completed calls | Live threads | Handles | Private committed MiB |
| --- | ---: | ---: | ---: | ---: |
| 1 x 1 | 1 | 59 | 820 | 201 |
| 1 x 1 | 3 | 105 | 1,118 | 302 |
| 1 x 1 | 5 | 151 | 1,416 | 369 |
| 0 x 0 | 1 | 37 | 655 | 127 |
| 0 x 0 | 3 | 37 | 666 | 133 |
| 0 x 0 | 5 | 37 | 671 | 131 |
| 0 x 0 | 7 | 37 | 679 | 164 |

With thumbnails enabled, roughly 23 threads remained per additional call. With thumbnails disabled, temporary capture activity returned to approximately 37 threads and memory fluctuated instead of following the same growth pattern. These are short reproductions, not an hours-long recording soak test. The native allocation responsible was not traced to a specific Electron, Chromium or GPU-driver implementation.

Correction in `src/main/app.ts`: use zero thumbnail dimensions to enumerate IDs and names without requesting previews. The same helper also serves display-media source selection. The subsequent replay-buffer redesign below changes storage and export separately.

Electron explicitly documents zero dimensions for source enumeration without thumbnails:
[Electron 31.7.7 desktopCapturer API](https://github.com/electron/electron/blob/v31.7.7/docs/api/desktop-capturer.md).

Validation: `npm run build` (includes TypeScript check), the 28 tests in `windowCaptureSources.test.ts` and `windowSourceListRefresh.test.ts`, and `git diff --check` passed. The installed application has not been replaced; its existing native allocations are not released by changing repository source.

## How the OBS replay buffer stores video

Inspected upstream OBS implementation on the same date:
[obs-ffmpeg-mux.c](https://github.com/obsproject/obs-studio/blob/0888aeafe1198809b6898e73b2c7e03bf5c22276/plugins/obs-ffmpeg/obs-ffmpeg-mux.c).

1. `replay_buffer_data` receives already encoded audio/video packets. The replay buffer is a deque in RAM, not an ever-growing list of raw frames or a directory of rolling video files.
2. Packets use reference counting (`obs_encoder_packet_ref`). `cur_size` and timestamps track buffered encoded bytes and duration.
3. `replay_buffer_purge` removes old packets as new packets arrive, according to `max_time` and a configured nonzero `max_size`.
4. `purge` preserves decodability by advancing to a video keyframe when removing the previous keyframe. `purge_front` calls `obs_encoder_packet_release`. This releases the payload when no other owner needs it.
5. Saving obtains additional references to the selected packets, adjusts timestamps, and starts `replay_buffer_mux_thread`. That thread writes encoded packets to the output container and releases its references; capture continues.
6. The limits are not an exact ceiling for all OBS memory: the implementation preserves keyframe context, encoding consumes additional resources, and an export can temporarily retain older packets. A zero size limit disables byte-based pruning.

For scale, encoded payload at 60 Mbit/s for 60 seconds is approximately 450 MB (429 MiB), before audio and overhead, per source. It should not grow with the total number of hours the application has been running.

## TradeTools replay buffer redesign

TradeTools keeps compressed MediaRecorder WebM sessions and FFmpeg fragmented MP4 units in a shared RAM buffer. Native screen capture streams MP4 boxes through stdout; it no longer writes rolling segment files or CSV lists. The first window path used recurring MediaRecorder sessions and did not resolve the high-resolution renderer growth measured below.

The configurable default budget is 512 MiB of retained compressed payload across all sources. Old unprotected WebM sessions are evicted whole; native MP4 fragments are independently decodable. Active trades and free recordings spill protected data to disk when the budget is reached. Export readers pin selected segments while materializing temporary files and the existing exact-trim pipeline creates the final clip. This is the same memory-first retention principle as OBS, adapted to TradeTools' WebM/MP4 session boundaries and existing clip trimming. The limit covers retained payloads, not the FFmpeg/Chromium encoder, parser transient allocations, or export copies.

The FFmpeg fragment parser was checked against a real encoded stream with arbitrary stdout splits; every extracted fragment decoded independently. Unit tests cover shared budget and protected spill. An hours-long soak of the new installed binary has not been performed, and the currently installed application has not been replaced. The source-discovery leak correction and buffer redesign address distinct causes of resource growth.

## Live dev recording follow-up, September 23

The dev Electron main process started at 10:03:40 and was still the same process during the later measurements. The actual configuration was a LootX window, native resolution, 30 FPS, 10-second chunk setting, VP9-preferred browser MediaRecorder, 60-second replay, and a 512 MiB compressed-payload limit. This route does not use the native screen FFmpeg encoder even though the GPU encoder was selected in settings. Clips completed successfully in the log at 10:06, 10:15, 10:22, 10:23 and 10:26.

| Local time | Main private MiB | Renderer private MiB | GPU private MiB | Main threads | Main handles |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10:10 | 416 | 962 | 205 | 77 | 1,593 |
| 10:30 | 409 | 1,866 | 391 | 98 | 2,729 |
| 10:48 | 442 | 2,681 | 394 | 100 | 3,611 |

The renderer increased by roughly 1.7 GiB in 38 minutes, while its thread count and handles remained approximately 50 and 478. Main-process threads are far below the installed old version's 15,958 but handles still rose; the short isolated source-list test with zero thumbnails had also shown a small handle increase per call. A count alone does not establish whether those handles remain live forever.

An isolated Electron 31.7.7 reproduction is in `tests/diagnostics/mediaRecorderMemory.cjs`. It used a separate temporary profile and a hidden desktop screen source at 1280 x 720, 15 FPS, VP9, 8-second MediaRecorder rotation and 2-second data events. Across 90 seconds and 11 recording sessions, renderer private memory stayed approximately 127-131 MiB, used V8 heap near 2.5 MiB after initial collection, and Blink allocated-memory counter remained small. The browser capture path and session rotation alone at this lighter workload did not reproduce the live growth. The test does not isolate the live native-resolution window capture, high bitrate, IPC/Blob transfer, or app-specific video preview.

An upstream Electron issue reports a similar combination of desktop getUserMedia and MediaRecorder memory growth with VP8/VP9; it is not proof of the same root cause here: https://github.com/electron/electron/issues/41123. The next controlled experiment should compare a separate full-resolution window capture with and without recorder rotation, while sampling renderer V8/Blink/native counters. It was deliberately not run concurrently with the live recording because the renderer already exceeded 2.6 GiB and physical free memory was below 5 GiB. Do not label the RAM-buffer change a complete fix until this growth is explained and a long soak is stable.

The isolated script accepts `TT_REPRO_SOURCE=window`, `TT_REPRO_WINDOW_NAME=LootX`, `TT_REPRO_NATIVE=1`, `TT_REPRO_FPS=30`, `TT_REPRO_BITRATE=60000000`, `TT_REPRO_SECONDS=90`, and `TT_REPRO_CONTINUOUS=1` (omitting the last variable rotates every 8 seconds). Run the two modes separately after the live recorder stops. The script reports only resource counters and encoded byte totals; it does not save captured content.

## Browser recorder lifecycle correction

The active browser recorder created a new `MediaRecorder` native wrapper on every 8-second WebM session. `WindowRecorderController` now creates one recorder per captured stream, calls `stop()` / `start()` on that same instance at the session boundary, and removes event handlers and its session reference when the capture truly stops. The pending-blob accounting no longer holds the entire `BlobEvent` in the completion callback. The independently decodable session rotation and encoded RAM budget remain unchanged.

The isolated 720p/15 FPS scenario with `TT_REPRO_REUSE=1` produced three sessions and nine data chunks within 21 seconds using the same instance. This validates restart behavior only.

## Continuous WebCodecs window encoder, September 23

Window capture now uses one continuous Mediabunny/WebCodecs encoder instead of MediaRecorder. It writes fragmented H.264/AAC MP4; completed fragments are transferred as encoded bytes, rebased to a local time origin, and retained in the same bounded shared RAM buffer. Fragments begin at keyframes about every two seconds and are evicted independently. The transfer queue remains capped at 48 MiB.

The environment probe found an RTX 4080 Laptop GPU and FFmpeg's NVENC encoder. Chromium's WebCodecs H.264 `prefer-hardware` configuration did not report support at 2560×1600; software H.264 did. This initial WebCodecs configuration used `no-preference`, so Chromium could select software encoding at the problematic native resolution. This is an architectural repair for unbounded MediaRecorder retention, but it is not evidence of NVENC use or OBS-equivalent CPU load. The earlier full suite passed 445/445 and production build completed. No long-duration memory comparison has been made after this change.

## Follow-up: explicit window encoder selection

A separate Electron 31.7.7 capability probe on the RTX 4080 Laptop GPU returned H.264 hardware support at 1920×1080 and 1280×720, but not at 2560×1600 or 2560×1440. The GPU preference now requests `prefer-hardware` when supported at the captured track's actual dimensions and explicitly reports a software fallback otherwise. WebCodecs does not bind to the specific NVIDIA adapter selected in FFmpeg settings; `prefer-hardware` is a request, not measured NVENC utilization. At native 2560×1600, the window remains full resolution and uses software H.264. Choosing the 1080p preset allows an accelerated request on this machine.

The native window bitrate at 30 FPS was reduced from 60 to 24 Mbit/s (1080p remains 12 Mbit/s). This reduces the theoretical 60-second compressed payload from roughly 450 MB to 180 MB at sustained target bitrate, before audio, buffering and encoder overhead; it does not prove that the previously observed 2.6 GiB Electron-main private memory was all retained video. The source discovery fix and stop-time payload release remain in place. The current saved `backgroundRecordingEnabled` is false and the Electron app was not running during this follow-up, so no live post-change memory slope or GPU-engine measurement was obtained.

Focused encoder/buffer tests and production build passed. The hardware support result came from a short isolated probe rather than an hours-long recording test.

## Confirmed startup failure and restart loop, September 23, 13:27-13:40

The dev main process PID 3088 continued accumulating native resources: 2,561 MiB private memory and 1,639 threads at the initial sample. A subsequent thread-start-address inventory found 2,016 threads in `nvwgf2umx.dll` and 96 in `GraphicsCapture.dll`. New groups appeared roughly every five seconds. This locates the retained resources, but does not identify a particular driver allocation or prove a driver defect.

A bounded IPC trace in the actual built application reproduced the startup error:

```text
Failed to construct 'Worker': Access to the script at 'blob:file:///...' is denied by the document's Content Security Policy.
```

Mediabunny starts a worker for its capture timer. The renderer policy allowed only `script-src 'self'` and had no `worker-src`. Each failed encoder start stopped the captured stream; source discovery retried five seconds later. The trace showed repeated `recording:browser-stopped` events and no successful start. During the same trace Electron source enumeration happened only once, so repeated desktop-source enumeration was not the cause of this remaining growth. The previous isolated MP4 test omitted the renderer CSP and therefore missed the startup failure.

Corrections:

- Allow `worker-src 'self' blob:` while keeping the existing script policy.
- Normalize odd capture dimensions for H.264 through Mediabunny's built-in transform. Keep the encoder alive when incoming frame dimensions change.
- Cancel the output if startup rejects, and release pending fragment references on stop.
- Run the diagnostic with the real renderer CSP, an odd-sized canvas, and a mid-recording resize. Decode every fragment with ffprobe instead of checking only container metadata.

Validation:

- Production build (including typecheck) and the 140 affected tests passed; the added startup-cancellation regression also passed.
- The diagnostic produced four independently decoded 320x180 fragments from 321x181 capture, including after a resize to 363x205.
- Fixed live app PID 176000 captured LootX at 3440x1392. At 409 seconds of process uptime it had started capture once, stopped zero times, and delivered 199 fragments. The main thread count stayed at 64-66, with approximately 1,216 handles. The built-in recording health check passed with fresh segments.
- A real live fragment decoded 60 H.264 frames at 3440x1392 without ffprobe errors.
- Main private memory rose from 259 MiB in the first resource sample to 427 MiB at the later snapshot, with 192 MiB of compressed footage retained for one genuinely open trade. The main JavaScript heap was about 16 MiB. Total app private memory was about 893 MiB at that snapshot. This is expected protected-footage accumulation; the configured 512 MiB shared payload budget and spill behavior have unit coverage. The live recording had not reached the budget yet.

The running dev app was left recording. Hardware H.264 remains unavailable at this capture resolution in the current Chromium environment, so this run uses software encoding. Intermittent WGC `ProcessFrame failed, using existing frame` messages remain in stderr; fragments continue arriving. Automatic export on the user's next real trade close and hours-long memory stability are not established by this check. No synthetic trade was inserted, and settings, saved clips, and protected footage were not cleared.

## Why GPU selection falls back to the CPU

The running application reports Electron 31.7.7 / Chromium 126.0.6478.234. Its Windows Media Foundation encoder advertises a hard-coded maximum of 1920x1088 in `GetSupportedProfiles`, with a transposed portrait profile, instead of querying the card's actual limit:
[Chromium source for the installed version](https://github.com/chromium/chromium/blob/126.0.6478.234/media/gpu/windows/media_foundation_video_encode_accelerator_win.cc#L520-L525).

The live renderer rejected `prefer-hardware` at 3440x1392 and 2560x1036 for all three tested H.264 profiles (High, Main, Baseline), but accepted 1920x776. NVIDIA was the active graphics adapter and `video_encode` was enabled. A separate FFmpeg `h264_nvenc` invocation successfully encoded 30 generated frames at 3440x1392 on GPU 0. Therefore this particular fallback comes from the current Chromium encoding path, not an inability of the GPU to encode the native resolution. Supporting that resolution on GPU still requires changing that path/runtime; the memory fix does not do that.

During the follow-up the capture preset changed, producing one stop/start and a new 2560x1036 stream. This expected configuration restart is distinct from the previously continuous five-second failure loop.

## Confirmed dev renderer leak and native-resolution GPU support, 14:22-14:51

The old live Electron 31 renderer reached 2,977 MiB private memory while the main process held approximately 512 MiB of compressed footage. Upgrading the runtime alone was insufficient: Electron 44 also accumulated renderer memory during the first minutes.

The renderer heap snapshot identified 361,000 native `PerformanceMeasure` objects. A subsequent live query counted 536,178 retained measurements, predominantly React development component timings (`Button`, `Card`, and `ClipCard`). React 19.2's development renderer calls `performance.measure` with serialized changed props on frequently updated components. Those entries live in Blink's performance timeline, outside the ordinary V8 heap accounting used by the earlier diagnosis. Therefore the earlier small V8 heap did not rule this leak out.

After clearing the performance timeline and collecting garbage once for diagnosis, the same recording renderer dropped to 171 MiB. `devPerformanceTimeline.ts` now uses a native `PerformanceObserver` to clear measurements after delivery, only in development. It neither schedules forced garbage collection nor touches encoded footage. The deliberate limitation is that `performance.getEntriesByType('measure')` no longer retains historical entries in development; profiling can use DevTools tracing. Production builds omit this cleanup.

The first live cleanup was installed at 14:37:39 without stopping capture. The source module then replaced that temporary observer in the same renderer. At 14:51:19, about 14 minutes later, the renderer used 355 MiB; intermediate samples fluctuated around 251-390 MiB instead of accumulating gigabytes. Total app private memory was approximately 1,513 MiB at that last sample, including 512 MiB of compressed footage protected for two actual open trades. The main process was approximately 829 MiB and the GPU process 267 MiB. The shared payload stayed below 536,870,912 bytes after reaching its cap; older protected footage continued spilling to disk. These observations are bounded, not an hours-long soak. A compact sample series is in `2026-09-23-electron44-memory.csv`.

Electron is now pinned to 44.4.5 (Chromium 152.0.7977.130), installed in `node_modules`, and running in the dev app. An isolated real-window test successfully encoded 3440x1601 capture, normalized to an even height, with `prefer-hardware`. In the running app, Windows GPU counters attributed activity to both VideoEncode engines of its GPU PID 149204 (sample: 6% and 4%). Thus this verification includes actual hardware encoding activity, not just a capability check. The running window later measured 3440x1392. Changing the CPU/GPU preference now also changes the controller effect dependency, and the fallback message no longer promises that selecting 1080p universally fixes it. Keytar's native binding and SSH loaded successfully on the new runtime.

### Export timestamp regression found by the real buffer save

A genuine 60-second buffer export initially failed with `first frame appeared after 552.000s`. `rebaseFragmentTrackTimestamps` searched for `traf` at the top level of the whole `moof` box, so it never visited its children and never reset `tfdt`. Earlier tests decoded fragments but did not check their local packet time origin.

The parser now skips the `moof` header before visiting tracks, including extended headers. Its real FFmpeg regression checks that both audio and video stream start times are within 50 ms of zero on every independently decoded fragment. The fixed parser was also applied to the running service and its 419 already retained fragments without restarting capture. A second save through the existing `clips:create-buffer` path succeeded. The resulting 3440x1392 H.264 clip was fully decoded by ffprobe: 60 seconds, 1,800 frames, no decoder errors. Automatic export on a subsequent real trade close has not been observed in this run; the manual save exercises the shared export pipeline.

Before the runtime restart, 1,073 existing fragments (923,311,167 bytes) and actual watcher metadata were backed up under the user's clip directory in `runtime-recovery-20260923-1790162756331`. They were normalized with the corrected parser and assembled into three playable `LootX-before-update-*.mp4` files corresponding to the prior capture epochs. Reported durations are approximately 573, 1,389, and 214 seconds. The restart introduced a capture gap; those old sections are preserved separately rather than represented as continuous footage across the restart. Existing settings, credentials, saved clips, and original backed-up fragments were preserved.

Validation: all 447 existing tests passed after the runtime update; the new development-timeline regression passed; the affected MP4 and recorder tests passed (82) after the timestamp correction; final production build/typecheck and `git diff --check` passed. DevTools sampling was diagnostic only and no recurring monitor was installed.

At the final check around 14:56, approximately 19 minutes after enabling cleanup, renderer private memory was 299.5 MiB, main 808.2 MiB, GPU 272.6 MiB, and the timeline retained zero measurements. Capture remained active with 754 segments and 534,990,953 payload bytes. The diagnostic timer and inspector were closed. Automatic approval review rejected deletion of the intermediate `normalized` recovery directory outside the project; those generated copies were left in place alongside the preserved originals and recovered MP4 files.
