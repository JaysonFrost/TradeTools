# TradeTools 0.7.1 Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish the LootX Unicode-symbol recording fix as TradeTools 0.7.1 with complete Windows and macOS updater assets.

**Architecture:** Keep the validated Unicode implementation unchanged, bump only release metadata, and publish through the existing tag-triggered GitHub Actions workflow. Treat the release as complete only after CI, all platform builds, public manifests, and checksums are verified.

**Tech Stack:** TypeScript, Electron, Vitest, electron-builder, GitHub Actions, GitHub Releases.

---

### Task 1: Prepare version metadata and changelog

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `../CHANGELOG.md`
- Create: `docs/plans/2026-09-01-tradetools-0.7.1-release.md`

**Step 1: Add the 0.7.1 changelog entry**

Document that Chinese and other Unicode terminal symbols now remain intact in LootX trade detection, position IDs, window selection, clip names, metadata, and TMM matching.

**Step 2: Synchronize package versions**

Run:

```powershell
npm version 0.7.1 --no-git-tag-version
npm install --package-lock-only
```

Expected: the root package entry and lockfile package entry both report `0.7.1`, with no dependency drift.

### Task 2: Validate the release source

**Files:**
- Test: `tests/unit/terminalSymbol.test.ts`
- Test: `tests/unit/terminalTradeRecorder.test.ts`
- Test: `tests/unit/terminalWindowSelection.test.ts`
- Test: `tests/unit/clipPaths.test.ts`
- Test: `tests/unit/tmmTradeMatcher.test.ts`
- Test: `tests/unit/settings.test.ts`

**Step 1: Run the complete validation suite**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: every command passes and all Unicode regression tests remain green.

**Step 2: Build the Windows updater payload**

Run the Windows NSIS build. If the running development app holds `keytar.node`, use the validated no-rebuild packaging path:

```powershell
npx electron-builder --win nsis --x64 --publish never --config.npmRebuild=false
```

Expected: `TradeTools-0.7.1-win-x64.exe`, its blockmap, and `latest.yml` are present and reference version 0.7.1.

### Task 3: Commit, push, and tag the release

**Files:**
- Stage the Unicode fix commit already on `main` plus the changelog, version metadata, and release plan.

**Step 1: Audit and commit release metadata**

Run `git status --short`, `git diff --check`, stage only intended files, and commit with `release: 0.7.1`.

**Step 2: Push main and the annotated tag**

Run:

```powershell
git push origin main
git tag -a v0.7.1 -m "TradeTools v0.7.1"
git push origin v0.7.1
```

Expected: local `main`, `origin/main`, and `v0.7.1` resolve to the release commit.

### Task 4: Verify CI and published updater assets

**Files:**
- Inspect: `../.github/workflows/ci.yml`
- Inspect: `../.github/workflows/release.yml`

**Step 1: Monitor GitHub Actions**

Wait for both the `CI` workflow on `main` and tag-triggered `Release` workflow to finish successfully. Retry only confirmed transient infrastructure failures.

**Step 2: Audit the GitHub Release**

Confirm all 13 expected files exist: Windows installer and blockmap, macOS DMG/ZIP plus blockmaps for arm64 and x64, `latest.yml`, `latest-mac.yml`, and `SHA256SUMS.txt`.

**Step 3: Verify public downloads and integrity**

Probe both public updater manifests for HTTP 200 and version 0.7.1. Parse `SHA256SUMS.txt`, compare every line to the corresponding GitHub asset digest, and verify the public Windows installer response.

Expected: the release is public, complete, and usable by electron-updater.
