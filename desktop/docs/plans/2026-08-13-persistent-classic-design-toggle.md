# Persistent Classic Design Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the user switch between the new engineering blueprint interface and the previous rounded dark interface, with the choice restored on the next app launch.

**Architecture:** Store a single `system.interfaceTheme` setting in the existing JSON settings store. AppShell applies it to the document root and passes a compact theme control to the sidebar immediately above the support button. CSS owns both visual systems so application behavior and component logic remain shared.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, Vitest.

---

### Task 1: Persist the preference

**Files:**
- Modify: `src/main/services/settings/settings.ts`
- Test: `tests/unit/settings.test.ts`
- Test: `tests/unit/settingsStore.test.ts`

1. Add the two allowed design values and default to the previous classic design.
2. Normalize invalid or legacy values to the classic design.
3. Verify that a saved classic value survives a store reload.

### Task 2: Apply and control the theme

**Files:**
- Modify: `src/renderer/components/layout/AppShell.tsx`
- Modify: `src/renderer/components/layout/Sidebar.tsx`
- Test: `tests/unit/blueprintDesign.test.ts`

1. Load the saved theme when AppShell opens and apply it to `<html data-theme>`.
2. Add an accessible compact switch immediately above “Сказать спасибо”.
3. Save a changed choice through the existing settings IPC and mirror it in local storage to avoid a visible flash on the next launch.

### Task 3: Restore the classic visual system

**Files:**
- Modify: `src/renderer/styles/tokens.css`
- Modify: `src/renderer/styles/globals.css`
- Modify: `src/renderer/components/ui/Button.tsx`
- Modify: `src/renderer/components/ui/Card.tsx`
- Modify: `src/renderer/components/ui/Badge.tsx`
- Modify: `src/renderer/components/layout/AppShell.tsx`
- Modify: `src/renderer/components/layout/Sidebar.tsx`
- Modify: `src/renderer/components/support/SupportDeveloperPage.tsx`

1. Keep classic as the default rounded dark design.
2. Re-enable the prior rounded, glass-like dark surface, typography, purple action palette and shell geometry only when the classic theme is selected.
3. Preserve all controls, statuses and accessibility labels.

### Task 4: Verify

**Files:**
- Modify only if validation exposes a defect.

1. Run the theme, setting, support and dashboard layout tests.
2. Run the full Vitest suite, TypeScript check, production build and diff check.
3. Do not launch or automate the UI; manual visual verification stays with the user.
