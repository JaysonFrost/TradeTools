# LootX Automatic Terminal Recording Implementation Plan

**Goal:** Record LootX trades with the existing buffered clip pipeline and automatically record only supported terminal windows without requiring a manual source selection.

**Architecture:** Treat Vataga, TigerTrade, LootX, and MetaScalp as one strict supported-terminal set shared by the main and renderer processes. Window mode is always automatic, so any persisted legacy window is ignored and the existing five-second source reconciliation force-refreshes and records every currently open supported terminal. Active browser-recorder lifecycle state removes a closed terminal from readiness immediately while its replay buffer remains available for an in-flight clip. Add LootX as a journal snapshot provider that reads atomic `%APPDATA%/TradingTerminal/journal.json` rewrites, ignores `SYNTHETIC_SEED`, deduplicates real fills, reconstructs per-account instrument position sizes, and emits the same open/update/close events used by the other terminal providers.

**Tech Stack:** Electron 31, React 19, TypeScript 6, Node.js filesystem APIs, Vitest.

---

### Task 1: Define the strict supported-terminal contract

**Files:**
- Create: `src/shared/supportedTerminalWindows.ts`
- Modify: `src/renderer/lib/windowCaptureSources.ts`
- Test: `tests/unit/windowCaptureSources.test.ts`

**Step 1: Write failing classifier tests**

Assert that window names for Vataga, Tiger/TigerTrade/Tiger.com, LootX, and MetaScalp are accepted, while HAPP, TradingView, MetaTrader, Binance, generic terminal windows, and screens are excluded.

**Step 2: Run the focused test and verify failure**

Run: `npx vitest run tests/unit/windowCaptureSources.test.ts`

Expected: FAIL because LootX is not recognized and the old broad preferred-terminal patterns are not the strict display contract.

**Step 3: Implement the shared classifier**

Export a `SupportedTerminalId` union, display labels, terminal-specific patterns, `detectSupportedTerminalWindow(name)`, and `isSupportedTerminalWindowName(name)`. Make `findAutoRecordedTerminalSources` use only that classifier and continue deduplicating capture source IDs.

**Step 4: Run the focused test**

Run: `npx vitest run tests/unit/windowCaptureSources.test.ts`

Expected: PASS.

### Task 2: Make terminal-window recording automatic and self-healing

**Files:**
- Modify: `src/renderer/components/recording/WindowRecorderController.tsx`
- Delete: `src/main/services/recording/tradeCaptureTargetSelection.ts`
- Modify: `src/main/services/recording/windowRecorderService.ts`
- Modify: `src/main/app.ts`
- Test: `tests/unit/windowRecorderService.test.ts`
- Delete: `tests/unit/tradeCaptureTargetSelection.test.ts`
- Test: `tests/unit/appLifecycle.test.ts`

**Step 1: Add failing stale-source and switching tests**

Cover stale saved Tiger plus live LootX, newly appearing terminals, multiple supported terminals, exact event-specific LootX target selection, reused window IDs, and removal of legacy nonterminal locks.

**Step 2: Verify focused failures**

Run: `npx vitest run tests/unit/windowRecorderService.test.ts tests/unit/appLifecycle.test.ts`

Expected: FAIL because a missing saved terminal currently returns no recording targets and remains authoritative for trade clips.

**Step 3: Implement automatic supported-terminal mode**

In window mode, always resolve recording targets from the current strict terminal source list instead of locking to any saved ID or name. Stop stale recorders before reporting an empty source list, and derive readiness only from browser recorder sessions that are still active. Force-refresh the source list on the existing five-second discovery loop so terminal start and stop changes reconcile without a settings-page refresh.

**Step 4: Route terminal trade events to the live matching window**

Add LootX to the main-process terminal mapping. Always force-refresh the capture source list on a trade entry, then use terminal type, process metadata when available, ticker title, cursor window, and deterministic fallback through the existing resolver. Keep exact source IDs authoritative so two same-named LootX windows never share readiness or replay segments.

**Step 5: Run focused tests**

Run: `npx vitest run tests/unit/windowRecorderService.test.ts tests/unit/appLifecycle.test.ts`

Expected: PASS.

### Task 3: Restrict both source pickers to the four supported terminals

**Files:**
- Modify: `src/renderer/components/settings/RecordingSettingsPanel.tsx`
- Modify: `src/renderer/components/setup/SetupWizard.tsx`
- Test: `tests/unit/windowSourceListRefresh.test.ts`
- Test: `tests/unit/dashboardLayout.test.ts`

**Step 1: Add failing source-list contract tests**

Assert that both renderer surfaces derive window options from `findAutoRecordedTerminalSources`, retain screen options in monitor mode, and never auto-save an asynchronous refresh response over a concurrent selection.

**Step 2: Run tests and verify failure**

Run: `npx vitest run tests/unit/windowSourceListRefresh.test.ts tests/unit/dashboardLayout.test.ts`

Expected: FAIL because both surfaces currently render all Electron window sources.

**Step 3: Filter the UI without reintroducing refresh races**

Use the strict helper for window mode in both components. Show every currently detected supported terminal as an informational automatic list instead of a manual window selector. Keep source refresh list-only and leave runtime switching to `WindowRecorderController`.

**Step 4: Run focused tests**

Run: `npx vitest run tests/unit/windowSourceListRefresh.test.ts tests/unit/dashboardLayout.test.ts`

Expected: PASS.

### Task 4: Add the LootX journal provider

**Files:**
- Modify: `src/main/services/trades/terminalTradeRecorder.ts`
- Test: `tests/unit/terminalTradeRecorder.test.ts`

**Step 1: Add failing parser and watcher tests**

Cover the Windows journal path, real fill parsing, decimal quantity scaling, `Bid` positive and `Ask` negative position changes, `SYNTHETIC_SEED` exclusion, `ExecId` deduplication, partial fills, scale-in/out, close, reversal, initial open-position reconstruction, atomic temporary JSON parse failure recovery, and `ResetTimestampMs` re-baselining without old clips.

**Step 2: Verify focused failures**

Run: `npx vitest run tests/unit/terminalTradeRecorder.test.ts`

Expected: FAIL because `lootx` is not a terminal source and no journal provider exists.

**Step 3: Implement pure LootX snapshot parsing**

Read `TradingTerminal/journal.json` as a whole JSON snapshot. Accept only structurally valid real trade rows, ignore `ExecId === 'SYNTHETIC_SEED'`, key fills by scoped `ExecId` with `TradeId` and composite fallbacks, normalize `Instrument.ExchangeId` and `Instrument.Symbol`, convert quantity using `QuantityScale`, and keep account separation with `ConnectionTag` in the internal position ID.

**Step 4: Integrate incremental polling**

Poll the atomic journal file with the other terminal providers. Baseline existing IDs, reconstruct any currently open real-fill position, emit unseen fills in timestamp order, protect video from the first fill, and pass flat/reversal transitions through the existing event pipeline. On a journal reset or truncation, preserve the known position state and apply only unseen replacement-snapshot fills so a close or reversal in the first new snapshot is not lost.

**Step 5: Run focused tests**

Run: `npx vitest run tests/unit/terminalTradeRecorder.test.ts`

Expected: PASS.

### Task 5: Update status copy and validate the complete feature

**Files:**
- Modify: `src/renderer/routes/Dashboard.tsx`
- Modify: `src/renderer/components/setup/setupWizardSteps.ts`
- Modify: `tests/unit/dashboardLayout.test.ts`

**Step 1: Add LootX to user-visible terminal status**

Show LootX in detected-source labels and all idle/setup text that currently lists Vataga, TigerTrade, and MetaScalp.

**Step 2: Run the complete test suite**

Run: `npm test`

Expected: all Vitest tests PASS.

**Step 3: Run static and production build checks**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

Run: `git diff --check`

Expected: no output and exit code 0.

**Step 4: Perform a safe live source probe**

With the already running LootX window, invoke the source-classification and target-resolution helpers against a fixture matching the live title/process and verify the stale Tiger configuration resolves to LootX. Do not stop or restart the user's terminal or active TradeTools process.

**Step 5: Commit the validated implementation**

Run: `git add docs/plans/2026-09-01-lootx-auto-terminal-recording.md src tests && git commit -m "feat: add automatic LootX trade recording"`

Expected: one local feature commit; no release, tag, or push unless explicitly requested.
