# Changelog

All notable changes to TradeTools will be documented in this file.

The project follows tag-based GitHub Releases. Version numbers are kept in `desktop/package.json`.

## [Unreleased]

## [0.3.3] - 2026-06-24

### Fixed

- Fixed stale built-in recorder segments being reused after increasing the pre-entry buffer.
- Terminal auto-recording now tracks only trades opened after recording starts.
- Ignored TigerTrade startup position snapshots that report no executions.

## [0.3.2] - 2026-06-18

### Fixed

- Removed the duplicate monitor selector from the auto-recording header; manual buffers and auto clips now use only the monitors selected in recording settings.
- Made clip progress clearer while TradeTools waits for the configured seconds after trade exit.
- Fixed terminal auto-recording creating extra videos for scale-ins and partial exits; one trade now creates one clip from the first entry to the final exit.

## [0.2.9] - 2026-06-15

### Fixed

- Fixed the development renderer crash caused by mismatched `react` and `react-dom` patch versions.
- Reissued the 0.2.8 recorder changes under a new version so installed clients can update normally.

## [0.2.6] - 2026-06-11

### Added

- Added a system notification when a new TradeTools version is available.
- Added live built-in video buffer progress so the UI shows how many seconds are saved out of the configured buffer.
- Added a clip render queue so terminal trades detected during video processing wait safely instead of being lost.
- Added a free terminal recording mode with start, pause, resume and finish controls.
- Added video buffer field hints that explain the difference between segment interval and pre-entry buffer.

### Changed

- Changed the heavy video preset to keep 10 minutes before entry and 120 seconds after exit.
- Built-in recorder clips now skip the second ffmpeg render when the replay is already trimmed to the final trade range.

### Fixed

- Fixed clip processing status getting stuck at 35% by returning a live elapsed-time progress estimate and queued clip count.
- Disabled cursor drawing in the optimized Windows ffmpeg recorder so the pointer is not burned into captured videos.
- Disabled the Windows `gdigrab` recorder by default because it can flicker the real cursor and interfere with games while TradeTools records in the background.

## [0.2.5] - 2026-06-11

### Added

- Added a heavy 10 minute before/after video preset with clear warnings about file size, processing time and delayed clip creation.
- Added an optimized built-in Windows recorder that captures through `ffmpeg`/`gdigrab` in the main process before falling back to Chromium capture.

## [0.2.4] - 2026-06-11

### Changed

- Prepared a follow-up release to validate automatic updates from installed TradeTools builds.

## [0.2.3] - 2026-06-11

### Fixed

- Fixed installed Windows builds being treated as update-disabled when Electron reports them as unpackaged or `app-update.yml` is not found.
- TradeTools now sets the GitHub update feed explicitly for installed builds.

## [0.2.2] - 2026-06-11

### Fixed

- Fixed phantom active trade status from the initial MetaScalp position snapshot.
- Closed or inactive MetaScalp position snapshots are now ignored.
- Active terminal trade status now shows the source that triggered recording.

## [0.2.1] - 2026-06-11

### Added

- Added automatic TigerTrade trade recording from local WorkLog position updates.
- Added automatic MetaScalp trade recording through the terminal's local read-only API.
- Added terminal watcher tests for Vataga, TigerTrade and MetaScalp event parsing.

### Changed

- Video UI now presents automatic recording as a general terminal mode instead of a Vataga-only mode.
- README and user guide now document Vataga, TigerTrade and MetaScalp as supported trade sources.

## [0.2.0] - 2026-06-08

### Added

- Added built-in terminal window recording mode, so trade clips can be created without OBS.
- Added window source selection, FPS and segment settings to video setup.
- Added IPC and main-process replay assembly for built-in window recording.

### Changed

- Video setup wizard now treats OBS as an optional alternative mode.
- Vataga terminal log watcher creates clips without exchange API keys.
- Built-in recorder now uses continuous recording sessions to avoid freezes from restarting capture every few seconds.
- Built-in recorder can capture either a window or a full screen, which helps bypass Windows Graphics Capture window freezes.
- Windows builds now disable Chromium WGC capture features to avoid stale-frame desktop capture errors.
- The old Binance API-key watcher and settings UI were removed.
- Built-in recording is now the default video mode and records through a fixed-FPS canvas stream before MediaRecorder encoding.
- Built-in recording now uses a 30-second idle replay window, while active trades keep their full segment history.
- Built-in recording now protects segments for open Vataga trades and exports the whole trade from entry to exit.
- Clip creation now shows an in-app progress bar while replay saving and ffmpeg processing are running.
- Clip processing progress is exposed through a generic clips status instead of an exchange watcher status.
- Native dropdowns now use a dark readable style.
- README and user guide now document the no-OBS recording flow.

## [0.1.2] - 2026-06-08

### Fixed

- Fixed Windows startup crash caused by importing `electron-updater` as an ESM named export.

## [0.1.1] - 2026-06-08

### Added

- In-app update checks, downloads and install prompt from GitHub Releases.

### Changed

- Reduced packaged Windows installer size by pruning unused ffprobe binaries and Electron locales.
- Release workflow now publishes updater metadata files for Windows and macOS.

### Removed

- Linux desktop release artifacts.

## [0.1.0] - 2026-06-08

### Added

- Local OBS Replay Buffer pipeline for trade clips.
- Vataga terminal auto-recording from local trade logs.
- Clip queue with preview, file open, folder open and video file rename.
- Proxy/VPS vault with monthly payment day, hosting link and keychain password storage.
- Drag-and-drop proxy chain ordering.
- Automatic Xray/VLESS proxy chain setup over SSH.
- Local HTTP proxy runtime on `127.0.0.1:1083` by default.
- System notifications for completed clips and proxy payment reminders.
- Autostart setting for launching TradeTools on system login.
- Donation page with USDT addresses and QR codes.
- GitHub Actions CI and release workflows.

### Removed

- Subscription/access gate logic.
- Telegram/Discord requirement logic.
- TradeCut/TradeCut API naming in public app surface.
