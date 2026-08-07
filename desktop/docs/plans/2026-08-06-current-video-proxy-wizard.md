# Current Video and Proxy Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the video and proxy setup wizard configure the capabilities that TradeTools currently supports, and backfill TMM links for existing review clips immediately after a key is connected.

**Architecture:** Reuse the established settings, clip metadata, and IPC layers. The wizard writes the same recording and proxy-runtime fields used by the full settings panels. TMM sync batches unlinked clips by ticker and calendar day and writes found links back into their existing metadata before confirming the saved key.

**Tech Stack:** Electron, React, TypeScript, Node fetch, keytar, Vitest.

---

### Task 1: TMM key link and historical clip sync

**Files:**
- Modify: `src/main/services/trades/tmmTradeMatcher.ts`
- Modify: `src/main/services/trades/tradeClipPipeline.ts`
- Modify: `src/main/app.ts`
- Modify: `src/renderer/components/settings/ObsSettingsPanel.tsx`
- Test: `tests/unit/tmmTradeMatcher.test.ts`
- Test: `tests/unit/tradeClipPipeline.test.ts`

1. Batch matching requests by ticker and date window, retaining the existing precise entry/exit tolerance.
2. Add a pipeline method that rewrites only missing TMM URLs in existing pending-clip metadata.
3. Start the sync after storing a TMM key and make the settings state explicit while it runs.
4. Add the official TMM API-key page as a trusted external link.
5. Test batch matching and persisted metadata updates.

### Task 2: Video wizard parity

**Files:**
- Modify: `src/renderer/components/setup/SetupWizard.tsx`
- Modify: `src/renderer/components/setup/setupWizardSteps.ts`
- Test: `tests/unit/setupWizardSteps.test.ts`

1. Preserve and configure selected capture targets, including multiple monitors.
2. Include current built-in-recording controls: encoder, system audio, and microphone.
3. Save source, targets, and recording options using the same fields as the main recording settings panel.
4. Update the step copy to distinguish built-in recording from OBS correctly.

### Task 3: Proxy wizard parity

**Files:**
- Modify: `src/renderer/components/setup/SetupWizard.tsx`
- Modify: `src/renderer/components/setup/setupWizardSteps.ts`
- Test: `tests/unit/setupWizardSteps.test.ts`

1. Permit one server or an optional second hop instead of requiring exactly two.
2. Let the user choose SOCKS5 or HTTP before local runtime setup.
3. Update the wizard copy to match persisted chain order, VPN checks, and current local proxy behavior.
4. Run focused tests, typecheck, build, and the Windows-safe full Vitest command.

### Task 4: Compact review queue

**Files:**
- Modify: `src/main/app.ts`
- Modify: `src/renderer/routes/Dashboard.tsx`
- Modify: `src/renderer/components/trade/ClipCard.tsx`

1. Increase the default window and queue viewport to keep four compact cards visible.
2. Reduce card spacing and button height without hiding the meaning of each action.
