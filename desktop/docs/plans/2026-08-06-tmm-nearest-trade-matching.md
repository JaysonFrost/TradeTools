# TMM Nearest Trade Matching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Match each TradeTools clip to the nearest TMM trade with the same normalized ticker when entry and exit timestamps differ.

**Architecture:** Keep the existing batched TMM request by ticker and date. Replace the strict two-minute equality gate with nearest-candidate scoring inside a bounded time window, then rerun synchronization automatically when the app starts with an existing TMM key.

**Tech Stack:** Electron, TypeScript, Node fetch, keytar, Vitest.

---

### Task 1: Nearest timestamp matching

**Files:**
- Modify: `src/main/services/trades/tmmTradeMatcher.ts`
- Test: `tests/unit/tmmTradeMatcher.test.ts`

1. Add a failing test with several same-ticker candidates whose timestamps differ by minutes.
2. Rank valid candidates by entry difference plus exit difference.
3. Accept the nearest candidate when both timestamp differences stay inside a 30-minute safety window.
4. Keep ticker normalization and reject unrelated or excessively distant trades.
5. Run `npx vitest run tests/unit/tmmTradeMatcher.test.ts`.

### Task 2: Resynchronize an already connected account

**Files:**
- Modify: `src/main/app.ts`

1. Detect an existing TMM key during startup.
2. Start missing-link synchronization without delaying the application window.
3. Log checked and matched counts without logging the key.
4. Run `npm run typecheck`, focused tests, and `npm run build`.
