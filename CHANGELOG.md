# Changelog

All notable changes to TradeTools will be documented in this file.

The project follows tag-based GitHub Releases. Version numbers are kept in `desktop/package.json`.

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
- Binance USDT-M Futures read-only integration.
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
