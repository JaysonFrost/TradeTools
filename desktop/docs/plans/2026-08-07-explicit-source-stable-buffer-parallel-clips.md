# Explicit Source, Stable Buffer, and Parallel Clips Plan

**Goal:** Respect the window selected by the user, never discard a trade because terminal-window discovery is briefly stale, keep the displayed replay buffer stable, and process independent clip jobs concurrently without returning to 100% CPU rendering.

## Evidence

- Live settings still point to `Vataga.terminal` after HAPP was selected.
- The browser recorder adds auto-discovered terminal windows to the explicit selection.
- The five-second source reconciliation publishes a synthetic status with `bufferedSeconds: 0`.
- Live logs show `HEIUSDT` and `KOMAUSDT` skipped when the terminal window was temporarily absent.
- Live logs also show four distinct clip jobs queued, but the renderer runs only one worker and exposes only one active job.

## Implementation

1. Add focused regression tests for explicit source precedence, missing-source behavior, stable buffer status, distinct simultaneous trades, and bounded parallel clip jobs.
2. Make explicit window selection authoritative. Use terminal auto-discovery only when no window has been configured, and never append a hidden terminal target behind the selected source.
3. When per-trade terminal discovery is temporarily unavailable, use the configured and already-recorded target instead of suppressing the trade.
4. Preserve the last real recorder counters during informational source reconciliation so the buffer cannot flicker to zero.
5. Replace the single clip worker with a bounded two-job pool and expose every active and queued job in processing status. Keep per-render FFmpeg thread limits conservative.
6. Verify targeted tests, the full suite, typecheck/build, live source selection, live status stability, and a controlled TradeTools restart without touching terminal processes.
