# Video Cache Location and Cleanup Design

## Goal

Keep built-in recording's temporary video files inside the user-configured clip folder, prevent stale cache growth and duplicate recorder storage, and provide a safe user-triggered cleanup for both the new cache and the legacy `window-recording` folder.

## Behavior

- Built-in recording segments are stored in `<clip.outputDir>/.tradetools-cache/segments`.
- Temporary replay export files are stored in `<clip.outputDir>/.tradetools-cache/replays`.
- Final clips continue to use the existing dated folders under `clip.outputDir`.
- Existing buffer pruning remains bounded by the configured replay buffer and active trade protection.
- Cache cleanup removes cache files and the legacy `<appDataDir>/window-recording` tree, but never removes final clips.
- Cleanup is rejected while an active trade or free recording is protected, preventing an incomplete clip.
- If background recording is enabled, cleanup restarts the native recorder after removing its files; browser fallback recording can continue with a fresh cache.

## Components

- `windowRecorderService`: resolve cache paths from current settings, track native recorder paths per cache directory, prune cache files and expose `clearCache`.
- Main IPC: expose `recording:clear-cache`, stop/clear/restart safely, and return a cleanup summary.
- Preload API: expose typed `recording.clearCache()`.
- Recording settings panel: add a destructive-but-explicit «Очистить кэш видео» button with progress/result feedback and a note that final clips are preserved.

## Safety and errors

- Cleanup uses recursive removal only on generated cache roots.
- The configured output folder is never removed.
- Cleanup is blocked when active trade/free-recording protection is present.
- File deletion tolerates already-missing files and reports the operation result to the user.

## Verification

- Unit tests assert the new segment path, bounded pruning, legacy cleanup, and preservation of final output files.
- Source-level UI/IPC tests assert the button and complete bridge wiring.
- Typecheck, unit tests, and production build must pass.
