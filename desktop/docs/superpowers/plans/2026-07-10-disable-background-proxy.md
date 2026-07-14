# Выключение фонового proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить кнопку выключения активного локального proxy, которая также запрещает его фоновую работу.

**Architecture:** Main process добавляет один IPC-обработчик, который сначала останавливает существующий Xray runtime, затем сохраняет `keepProxyRunningAfterClose: false`. Preload экспортирует метод, а карточка подключения отображает кнопку только для запущенного runtime.

**Tech Stack:** Electron, TypeScript, React, Vitest.

## Global Constraints

- Не добавлять зависимостей или новых фоновых процессов.
- Не менять цепочку серверов, настройки терминала и VPN bypass-маршруты.
- При ошибке остановки не менять настройку фоновой работы.

---

### Task 1: IPC выключения proxy

**Files:**
- Modify: `src/main/app.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/unit/appLifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('stops the proxy and disables background operation', async () => {
  await handlers['proxies:disconnect-runtime']()
  expect(stopLocalXrayRuntime).toHaveBeenCalledOnce()
  expect(settingsStore.update).toHaveBeenCalledWith({
    system: { keepProxyRunningAfterClose: false }
  })
})
```
- [ ] **Step 2: Run the focused test and confirm it fails because the handler is missing.**

Run: `npm test -- tests/unit/appLifecycle.test.ts`

- [ ] **Step 3: Add the handler and preload method.**

```ts
ipcMain.handle('proxies:disconnect-runtime', async () => {
  await stopLocalXrayRuntime()
  return settingsStore.update({ system: { keepProxyRunningAfterClose: false } })
})
```

- [ ] **Step 4: Run the focused test and confirm it passes.**

Run: `npm test -- tests/unit/appLifecycle.test.ts`

### Task 2: Кнопка в карточке подключения

**Files:**
- Modify: `src/renderer/components/settings/ProxyVaultPanel.tsx`

- [ ] **Step 1: Add an action that calls `window.api.proxies.disconnectRuntime()` and refreshes the connection state.**

```ts
await window.api.proxies.disconnectRuntime()
await refreshConnectionState()
```

- [ ] **Step 2: Render «Выключить proxy» next to the connection action only while the local runtime is active.**

```tsx
{connectionState.running && (
  <Button type="button" variant="secondary" onClick={() => void disconnectProxy()}>
    Выключить proxy
  </Button>
)}
```
