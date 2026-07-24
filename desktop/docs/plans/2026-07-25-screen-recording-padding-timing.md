# Screen Recording Padding Timing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the configured before/after values surround the visible terminal position change.

**Architecture:** The clip pipeline already trims the built-in recording correctly when supplied with screen-aligned entry and exit timestamps. Vataga's `Position changed` log row contains two clocks: exchange fill time (`TradeTime`) and terminal update time (`@t`). Use `@t` for recording boundaries; retain `TradeTime` as a fallback for incomplete legacy rows.

**Tech Stack:** TypeScript, Vitest, Electron main process.

---

### Task 1: Lock the visible-terminal timing contract

**Files:**
- Modify: `tests/unit/terminalTradeRecorder.test.ts:36-62`

**Step 1: Write the failing test**

Expect `parseVatagaPositionEvent` to use the `@t` timestamp when both fields are present.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/terminalTradeRecorder.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: the parser returns the older `TradeTime` value instead of the terminal update time.

### Task 2: Use the terminal update timestamp

**Files:**
- Modify: `src/main/services/trades/terminalTradeRecorder.ts:254`

**Step 1: Write minimal implementation**

Prefer `parseVatagaTime(payload['@t'])` and fall back to `parseVatagaTime(payload.TradeTime)` only if the log timestamp is unavailable.

**Step 2: Run the targeted tests**

Run: `npx vitest run tests/unit/terminalTradeRecorder.test.ts tests/unit/tradeClipPipeline.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: PASS.

### Task 3: Verify the full build contract

**Files:**
- Verify: `src/main/services/trades/terminalTradeRecorder.ts`
- Verify: `tests/unit/terminalTradeRecorder.test.ts`

**Step 1: Run the full test suite**

Run: `npx vitest run --pool=forks --poolOptions.forks.singleFork=true`

Expected: PASS.

**Step 2: Run production checks**

Run: `npm run typecheck` and `npm run build`

Expected: both commands exit successfully.
