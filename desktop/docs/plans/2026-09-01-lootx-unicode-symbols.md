# LootX Unicode Symbols Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve Chinese and other Unicode letters in LootX symbols from journal parsing through window selection, clip filenames, metadata, and TMM matching.

**Architecture:** Add one shared Unicode-aware symbol-token normalizer based on NFKC plus Unicode letter, mark, and number categories. Replace the duplicated ASCII-only normalizers in the trade recorder, capture settings, window selector, clip path builder, and TMM matcher while keeping punctuation-removal behavior unchanged.

**Tech Stack:** TypeScript, Electron, Node.js, Vitest, Unicode property escapes.

---

### Task 1: Reproduce the parser and filename regression

**Files:**
- Modify: `tests/unit/terminalTradeRecorder.test.ts`
- Modify: `tests/unit/clipPaths.test.ts`

**Step 1: Write the failing parser test**

Add a LootX fixture with `symbol: '龙虾USDT'` and assert that `parseLootxJournalSnapshot()` returns a fill whose `symbol` and `positionId` retain `龙虾USDT`.

**Step 2: Write the failing filename test**

Call `buildClipFileNames()` with `symbol: '龙虾USDT'` and assert that the title, MP4 filename, and JSON filename start with `龙虾USDT`.

**Step 3: Run the tests to verify the current failure**

Run: `npx vitest run tests/unit/terminalTradeRecorder.test.ts tests/unit/clipPaths.test.ts`

Expected: the parser returns `USDT` and the filename starts with `USDT`, proving the ASCII-only bug.

### Task 2: Add shared Unicode-safe normalization

**Files:**
- Create: `src/shared/terminalSymbol.ts`
- Create: `tests/unit/terminalSymbol.test.ts`

**Step 1: Add direct normalization tests**

Cover `龙虾USDT`, `BTC/USDT`, full-width `ＢＴＣ／ＵＳＤＴ`, whitespace, and invalid non-text values.

**Step 2: Implement the minimal helper**

Implement `normalizeTerminalSymbolToken(value)` by converting supported scalar values to text, trimming, applying `normalize('NFKC')`, uppercasing, and removing everything except Unicode `Letter`, `Mark`, and `Number` categories with `/[^\p{L}\p{M}\p{N}]+/gu`.

**Step 3: Run the helper tests**

Run: `npx vitest run tests/unit/terminalSymbol.test.ts`

Expected: PASS.

### Task 3: Route every symbol consumer through the helper

**Files:**
- Modify: `src/main/services/trades/terminalTradeRecorder.ts`
- Modify: `src/main/services/video/clipPaths.ts`
- Modify: `src/main/services/recording/terminalWindowSelection.ts`
- Modify: `src/main/services/trades/tmmTradeMatcher.ts`
- Modify: `src/main/services/settings/settings.ts`
- Modify: `tests/unit/terminalWindowSelection.test.ts`
- Modify: `tests/unit/tmmTradeMatcher.test.ts`
- Modify: `tests/unit/settings.test.ts`

**Step 1: Replace ASCII-only symbol cleanup**

Import `normalizeTerminalSymbolToken()` and use it for parsed terminal symbols, clip display symbols, persisted capture symbols, and TMM comparison/query symbols.

**Step 2: Make title matching Unicode-aware**

Build ticker patterns from Unicode code points and use Unicode letter, mark, and number boundaries so `龙虾USDT` matches the correct titled window without suffix collisions.

**Step 3: Add consumer regressions**

Assert Unicode window-title matching, persisted capture-target symbols, and TMM query/matching behavior for `龙虾USDT`.

**Step 4: Run focused tests**

Run: `npx vitest run tests/unit/terminalSymbol.test.ts tests/unit/terminalTradeRecorder.test.ts tests/unit/clipPaths.test.ts tests/unit/terminalWindowSelection.test.ts tests/unit/tmmTradeMatcher.test.ts tests/unit/settings.test.ts`

Expected: PASS.

### Task 4: Validate the full application and live LootX data

**Files:**
- Verify only: `C:\Users\Igor\AppData\Roaming\TradingTerminal\journal.json`

**Step 1: Run repository validation**

Run: `npm test`, `npm run typecheck`, and `npm run build`.

Expected: all commands PASS.

**Step 2: Replay a sanitized live journal slice**

Read the existing `龙虾USDT` fills without modifying the journal, parse them through the built code, and assert that generated trade events and filenames retain `龙虾USDT`.

**Step 3: Restart TradeTools only**

Gracefully stop the scoped TradeTools dev process, keep LootX running, start `npm run dev`, and verify recording remains active with LootX automatically selected.

**Step 4: Commit after validation**

Stage only the Unicode implementation, tests, and this plan. Commit with `fix: preserve Unicode terminal symbols`.
