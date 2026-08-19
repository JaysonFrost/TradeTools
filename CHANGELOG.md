# Changelog

All notable changes to TradeTools will be documented in this file.

The project follows tag-based GitHub Releases. Version numbers are kept in `desktop/package.json`.

## [Unreleased]

## [0.6.2] - 2026-08-19

### Fixed

- Fixed the recording mini-widget being placed inside the Windows taskbar and becoming visually unavailable in the release build.
- The widget now stays immediately above the taskbar and is created as a visible window at startup, while the always-on-top pin behavior remains available.

## [0.6.1] - 2026-08-19

### Added

- Added one-click saving of the latest recording buffer from the compact widget and a global `Ctrl/Cmd+Shift+F10` shortcut for moments missed outside a trade.
- Added a pin control that switches the widget between always-on-top taskbar placement and normal placement above the work area.
- Added clear buffer-saving feedback and an accurate unavailable-hotkey state when another application owns the shortcut.

### Changed

- Reduced the recording widget to a compact single-row panel sized to the Windows taskbar, while keeping recording, buffer, pin, open, and close controls available.
- Repositioned the widget after taskbar, display-metric, or monitor changes and reserved space for the Windows notification area.
- Multi-monitor buffer saves now run as one coordinated operation with a shared request time.

### Fixed

- Prevented overlapping widget, dashboard, and hotkey requests from creating duplicate buffer renders.
- Prevented overlapping recording-toggle operations and blocked recording shutdown while the latest buffer is being saved.
- Prevented buffer-save jobs from racing with application shutdown, including partial multi-monitor failures and already-started saves during graceful quit.
- Kept the widget pin state synchronized after reload or reopen.

## [0.6.0] - 2026-08-14

### Added

- Added a compact always-on-top recording widget with live status, start/stop controls, a global `Ctrl/Cmd+Shift+F9` shortcut, and drag support across its non-interactive surface.
- Added persistent Classic and Engineering Blueprint interface themes. Classic remains the default, and the recording widget follows the selected theme.

### Changed

- Reworked the interface and setup flow around the built-in window and display recorder, with improved contrast in the Classic theme.
- Replaced the old OBS connection flow with automatic migration to the built-in recorder and removed OBS-specific settings, services, and dependencies.
- Rebuilt the video health check so it waits for a fresh recording segment from the current session and reports progress or a useful failure directly in the main window.
- Recording enabled state now persists between launches and stays synchronized between the dashboard, widget, and global shortcut.

### Fixed

- Fixed long manual recordings being exported at roughly twice the requested duration because buffer padding was counted twice.
- Prevented recording controls from stopping protected active trades, free recordings, or clip processing, and hardened recording IPC so only the main window can invoke capture operations.
- Fixed the Classic theme retaining Blueprint component styling and improved muted-text readability on the purple background.

## [0.5.2] - 2026-08-07

### Fixed

- Fixed parallel clip renders occasionally parsing incomplete FFprobe JSON and losing one otherwise valid trade video.
- Fixed browser-session media probes evaluating FFprobe output before its streams had fully closed, which could cause false duration and audio detection failures.

## [0.5.1] - 2026-08-07

### Changed

- An explicitly selected recording window is now authoritative for both background capture and every terminal trade, without silently adding another terminal window.
- Built-in recording can render two independent trade clips in parallel, while OBS replay saves remain serialized and every FFmpeg process is limited to one render thread.
- The processing panel now shows every active and waiting video as a separate compact row with a clear cancel or remove action.

### Fixed

- Fixed HAPP selections being overwritten by stale Vataga auto-detection and fixed saved windows disappearing from the source picker during a temporary capture-list miss.
- Fixed trades being skipped when the selected window briefly disappears from desktop capture discovery, and made manual source refresh bypass the source cache.
- Fixed the video buffer indicator alternating between its real duration and zero during periodic source reconciliation.
- Fixed simultaneous trades overwriting each other, losing replay files during late cancellation, or releasing the next worker before FFmpeg had actually exited.
- Fixed concurrent TradeTools installations and development builds sharing the same settings and recording cache by adding an atomic cross-build instance lock and graceful render shutdown.
- Fixed automatic no-source mode and multi-screen fallback repeatedly losing their buffer or restarting secondary recorders.

## [0.5.0] - 2026-08-07

### Added

- Added TraderMake.Money integration with secure API-key storage, automatic nearest-trade matching by ticker and time, direct journal links, startup synchronization, and automatic local video-path updates.
- Added clip search by local path, file name, ticker, trade details, and date.
- Added automatic discovery and independent recording of multiple terminal windows and overlapping trades on different symbols.

### Changed

- Updated the video and proxy setup wizards to match current recording, audio, encoder, monitor, protocol, and proxy-chain settings.
- Reworked the recording step layout so the source selector has its own responsive row and video fields no longer overlap in compact windows.
- Made the review queue taller and more compact, with smaller buttons and clearer actions for opening, renaming, removing, and deleting videos.
- Native capture now preserves the selected display or window resolution, while clip rendering uses a bounded CPU thread budget.

### Fixed

- Fixed long Chromium recordings losing or freezing the tail after a 60-second MediaRecorder rotation when WebM audio and video stream order changes.
- Fixed browser-session stitching across wall-clock gaps and overlaps, mixed audio availability, late video start, internal packet gaps, missing tails, muted tracks, and non-empty final chunks.
- Fixed cleanup of temporary or partial recording files after failed and cancelled renders.
- Fixed recording recovery after terminal startup or window changes, including independent timing and padding for concurrent symbol trades.
- Moved Windows window-metadata lookup off the renderer-critical path to avoid capture discovery stalls.

## [0.4.8] - 2026-08-04

### Changed

- macOS updates now open the GitHub release page for manual DMG installation while release signing and notarization are unavailable.

### Fixed

- Fixed repeated update prompts after an installation attempt leaves the previous app version in place.
- Windows now stops recording and clip rendering before running the updater, then installs the downloaded release silently.
- Repeated update events for the currently installed version are ignored.

## [0.4.7] - 2026-08-04

### Changed

- Added separate native macOS release packages for Apple Silicon and Intel, with shared automatic update metadata.
- Updated the developer support payment addresses for TRC20 and BSC.

### Fixed

- Fixed TigerTrade automatic recording after a month rollover when the WorkLog filename date belongs to the previous month.
- Fixed Apple Silicon packages bundling an Intel-only FFprobe executable.

## [0.3.8] - 2026-06-28

### Fixed

- Fixed phantom TigerTrade positions from startup WorkLog replay, including simulator rows and stale historical executions.
- Fixed TigerTrade zero-size close rows with `Executions=0` being ignored.

## [0.3.7] - 2026-06-27

### Fixed

- Fixed terminal auto-recording missing the first TigerTrade position when the terminal log appears after TradeTools has already started recording.
- Fixed active terminal trades being forgotten after a background recording restart.

## [0.3.6] - 2026-06-26

### Changed

- Reduced built-in window recorder source scans and status polling to avoid background thread buildup.
- Lowered native screen recording frame rate cap to 24 FPS.

### Fixed

- Removed temporary replay files after ready built-in clips are moved into the final clip folder.

## [0.3.5] - 2026-06-25

### Fixed

- Fixed built-in monitor recording so selected monitors stay saved after restart.
- Fixed trade clips failing with "0 seconds accumulated" even while TradeTools was running.
- Improved multi-monitor recording recovery when Windows changes internal screen IDs.

## [0.3.4] - 2026-06-24

### Added

- Added recording encoder device discovery so settings show only detected GPUs plus CPU.
- Added explicit ffmpeg encoder selection for detected NVIDIA, AMD and Intel adapters.

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
