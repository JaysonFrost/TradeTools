# TMM Video Path and Clip Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically save each matched clip's local Windows path into the TMM trade `video_link` field and let the queue find clips by path, file name, trade details, or date.

**Architecture:** Extend the existing TMM client with one authenticated update call. Store the last successfully synchronized video path in clip metadata so failed updates can retry during normal TMM synchronization and renamed files can update the remote value. Keep search entirely in the renderer with a pure tested filter over the already loaded queue.

**Tech Stack:** Electron, TypeScript, React, Vitest, TMM API v2.

---

### Task 1: Add the TMM video path update client

**Files:**
- Modify: `src/main/services/trades/tmmTradeMatcher.ts`
- Modify: `tests/unit/tmmTradeMatcher.test.ts`

**Steps:**
1. Add failing tests for `POST /trades/{id}/update`, the `API-KEY` header, and the `video_link` JSON payload.
2. Add safe handling for invalid trade URLs and non-successful TMM responses.
3. Implement the smallest client function that extracts the generated TMM trade ID and updates only `video_link`.
4. Run the matcher unit tests.

### Task 2: Synchronize local paths when clips are created, linked, or renamed

**Files:**
- Modify: `src/main/services/trades/tradeClipPipeline.ts`
- Modify: `src/main/app.ts`
- Modify: `tests/unit/tradeClipPipeline.test.ts`

**Steps:**
1. Add failing pipeline tests for immediate path upload after a clip is matched.
2. Add a retry test for metadata that has a TMM URL but no successful path marker.
3. Add a rename test that updates TMM and persists the new synchronized path.
4. Add an optional `tmmVideoPath` metadata field holding the last successfully synchronized local path.
5. Wire the TMM update dependency through the main process and keep clip creation successful when TMM is temporarily unavailable.
6. Run the pipeline unit tests.

### Task 3: Add queue search

**Files:**
- Modify: `src/renderer/lib/clipList.ts`
- Modify: `src/renderer/routes/Dashboard.tsx`
- Modify: `tests/unit/clipList.test.ts`

**Steps:**
1. Add failing tests for Windows paths, slash normalization, file names, ticker, combined terms, and local date formats.
2. Implement a pure case-insensitive filter that requires every search term to match the clip's searchable text.
3. Add a compact search field and clear button to the queue controls.
4. Build visible groups and period selection from filtered clips while keeping existing selected items stable.
5. Show the visible result count and a search-specific empty state.
6. Run the clip list unit tests.

### Task 4: Verify the complete change

**Files:**
- Verify all modified source and test files.

**Steps:**
1. Run the focused matcher, pipeline, and clip list tests together.
2. Run TypeScript type checking.
3. Run the production build.
4. Review the final diff for unrelated changes and report any pre-existing full-suite failures separately.
