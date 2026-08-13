# Engineering Blueprint Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restyle the complete TradeTools renderer as a compact engineering blueprint while preserving every existing workflow.

**Architecture:** Keep the current React component tree and Electron behavior. Replace the shared design tokens and primitive styles first, then align the shell, dashboards, settings, setup flow, clip queue and recording widget to the same sharp technical language. Use only CSS, Tailwind classes and the existing Lucide icons.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, Lucide React, Vitest.

---

### Task 1: Lock the visual contract

**Files:**
- Create: `tests/unit/blueprintDesign.test.ts`

1. Assert the blueprint palette, grid background, monospace typography and zero-radius primitives.
2. Assert that the shell no longer uses page-entry motion.
3. Assert that the recording widget shares the same palette and geometry.

### Task 2: Replace the shared visual system

**Files:**
- Modify: `src/renderer/styles/tokens.css`
- Modify: `src/renderer/styles/globals.css`
- Modify: `src/renderer/components/ui/Button.tsx`
- Modify: `src/renderer/components/ui/Card.tsx`
- Modify: `src/renderer/components/ui/Badge.tsx`

1. Add the dark navy, cyan line, orange action and green status tokens.
2. Draw the drafting grid with static CSS backgrounds.
3. Make controls and cards sharp, compact and keyboard-visible.

### Task 3: Redesign the application shell

**Files:**
- Modify: `src/renderer/components/layout/AppShell.tsx`
- Modify: `src/renderer/components/layout/Sidebar.tsx`
- Modify: `src/renderer/components/layout/TopBar.tsx`
- Modify: `src/renderer/components/updates/UpdateBanner.tsx`

1. Replace rounded glass navigation with a structured technical rail.
2. Add clear section identifiers and blueprint annotations.
3. Remove decorative entry animation and keep static utility feedback.

### Task 4: Redesign operational pages

**Files:**
- Modify: `src/renderer/routes/Dashboard.tsx`
- Modify: `src/renderer/components/settings/*.tsx`
- Modify: `src/renderer/components/setup/SetupWizard.tsx`
- Modify: `src/renderer/components/trade/*.tsx`
- Modify: `src/renderer/components/support/SupportDeveloperPage.tsx`
- Modify: `src/renderer/components/integrations/IntegrationStatusCard.tsx`

1. Apply consistent panels, labels, inputs, status colors and action hierarchy.
2. Preserve recording, proxy, setup, queue, delete and support behavior.
3. Keep the dense desktop layout responsive below 768px.

### Task 5: Align the recording widget

**Files:**
- Modify: `src/renderer/components/recording/RecordingWidget.tsx`
- Modify: `src/renderer/styles/globals.css`

1. Match the compact widget to the blueprint palette and zero-radius geometry.
2. Preserve drag region, live status, toggle, close and open-main actions.

### Task 6: Verify

**Files:**
- Modify only when validation finds a defect.

1. Run the focused design and layout tests.
2. Run the full Vitest suite.
3. Run `npm run typecheck`, `npm run build` and `git diff --check`.
4. Do not launch UI automation. Manual visual testing remains with the user.
