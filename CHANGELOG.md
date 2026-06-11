# Changelog

All notable changes to TradeTools will be documented in this file.

The project follows tag-based GitHub Releases. Version numbers are kept in `desktop/package.json`.

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
