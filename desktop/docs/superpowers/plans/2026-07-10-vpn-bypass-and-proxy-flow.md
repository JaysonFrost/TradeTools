# Автоматический VPN bypass и понятный поток прокси Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматически сохранять прямой маршрут компьютера к входному VPS при смене Happ/v2RayTun или сети и сделать подключение торгового proxy понятным одной основной кнопкой.

**Architecture:** Активный `trade-chain.json` — единственный источник VPS-адресов, к которым подключается компьютер. Монитор с интервалом 15 секунд сверяет физический gateway, TUN и `/32`; elevated PowerShell обновляет лишь маршруты, созданные TradeTools. Main process управляет монитором и узким IPC, renderer показывает короткий статус, а логи переносит в закрытую диагностику.

**Tech Stack:** Electron 31, TypeScript, React 19, Node.js `fs/promises`/`dns/promises`, Windows PowerShell/`route.exe`, Vitest.

## Global Constraints

- Терминалы сохраняют единственную настройку `HTTP 127.0.0.1:<локальный порт TradeTools>`; их настройки не изменять.
- Список bypass-адресов брать только из `%APPDATA%/tradetools/xray-runtime/trade-chain.json`.
- Happ и v2RayTun распознавать общим TUN-шаблоном, без API конкретного клиента.
- Не изменять default route, DNS, системный proxy, правила VPN или чужие `/32`.
- Не устанавливать службу, драйвер, планировщик либо постоянный привилегированный процесс.
- Проверять fingerprint каждые 15 секунд, лишь пока работает локальный Xray; отменённый UAC не повторять до смены fingerprint или явного обновления.
- Автоматическая запись маршрутов остаётся только Windows. Не добавлять зависимости.

---

## File Structure

- Create `src/main/services/proxies/xrayBypassTargets.ts`: чтение VLESS `vnext` из локального Xray config и резолв уникальных IPv4.
- Create `src/main/services/proxies/vpnBypassMonitor.ts`: таймер, fingerprint, сериализация проверок, статус и suppression UAC.
- Modify `src/main/services/proxies/xrayLocalRuntime.ts`: использует экспортируемый путь Xray config.
- Modify `src/main/services/proxies/vpnBypassRoutes.ts`: реестр собственных маршрутов, non-elevated inspection и безопасная замена устаревшего собственного `/32`.
- Modify `src/main/services/proxies/proxyChainSetup.ts`: повторно запускает сохранённый local runtime без SSH/переустановки VPS.
- Modify `src/main/app.ts` and `src/preload/index.ts`: lifecycle монитора, IPC connection/status/refresh и status event.
- Create `src/renderer/components/settings/proxyConnectionState.ts`: чистая модель краткой карточки.
- Modify `src/renderer/components/settings/ProxyVaultPanel.tsx`: connection-first UI, отдельная проверка, diagnostics и collapsible servers.
- Create `tests/unit/xrayBypassTargets.test.ts`, `tests/unit/vpnBypassMonitor.test.ts`, `tests/unit/proxyConnectionState.test.ts`; modify `tests/unit/proxyChainSetup.test.ts`, `tests/unit/appLifecycle.test.ts`, `docs/USER_GUIDE_RU.md`.

## Public Interfaces

```ts
// xrayBypassTargets.ts
export type XrayBypassTarget = { host: string; address: string }
export const localXrayConfigPath = (appDataDir: string): string => join(appDataDir, 'xray-runtime', 'trade-chain.json')
export const parseXrayBypassHosts = (config: unknown): string[] => string[]
export const resolveXrayBypassTargets = (configPath: string, resolveHost?: (host: string) => Promise<string>): Promise<XrayBypassTarget[]>

// vpnBypassRoutes.ts
export type VpnBypassStatus = {
  state: 'idle' | 'checking' | 'protected' | 'not-required' | 'needs-uac' | 'attention'
  message: string
  fingerprint: string
  targets: XrayBypassTarget[]
  gateway: string
  interfaceName: string
  checkedAtMs: number
}
export const inspectVpnBypassState = (input: { appDataDir: string; configPath?: string }): Promise<VpnBypassStatus>
export const configureVpnBypassRoutes = (input: { appDataDir: string; configPath?: string }): Promise<VpnBypassRouteResult>

// vpnBypassMonitor.ts
export type VpnBypassMonitor = { start: () => Promise<void>; stop: () => void; refresh: (options?: { force?: boolean }) => Promise<VpnBypassStatus>; getStatus: () => VpnBypassStatus }
export const createVpnBypassMonitor = (input: { appDataDir: string; configPath: string; intervalMs?: number; onStatus: (status: VpnBypassStatus) => void }): VpnBypassMonitor
```

### Task 1: Parse Xray config into bypass targets

**Files:** Create `src/main/services/proxies/xrayBypassTargets.ts`; create `tests/unit/xrayBypassTargets.test.ts`.

**Produces:** the target resolver consumed by every route operation.

- [ ] **Step 1: Write failing tests for VLESS parsing, resolution, deduplication, and an invalid config.**

```ts
it('returns unique IPv4 VLESS endpoints', async () => {
  await writeFile(configPath, JSON.stringify({ outbounds: [{ protocol: 'vless', settings: { vnext: [
    { address: '198.51.100.10' }, { address: 'entry.example' }, { address: '198.51.100.10' }
  ] } }] }))
  await expect(resolveXrayBypassTargets(configPath, async () => '203.0.113.20')).resolves.toEqual([
    { host: '198.51.100.10', address: '198.51.100.10' }, { host: 'entry.example', address: '203.0.113.20' }
  ])
})
it('rejects a config without VLESS VPS address', async () => {
  await writeFile(configPath, JSON.stringify({ outbounds: [{ protocol: 'freedom' }] }))
  await expect(resolveXrayBypassTargets(configPath)).rejects.toThrow('В активной Xray-конфигурации не найден адрес VPS')
})
```

- [ ] **Step 2: Run `npm test -- tests/unit/xrayBypassTargets.test.ts`; expect module-resolution failure.**

- [ ] **Step 3: Implement the minimal parser.**

```ts
export const parseXrayBypassHosts = (config: unknown): string[] => {
  const outbounds = config && typeof config === 'object' ? (config as { outbounds?: unknown }).outbounds : undefined
  if (!Array.isArray(outbounds)) return []
  const hosts = outbounds.flatMap((outbound) => {
    const value = outbound as { protocol?: unknown; settings?: { vnext?: unknown } }
    if (!value || value.protocol !== 'vless' || !Array.isArray(value.settings?.vnext)) return []
    return value.settings.vnext.flatMap((node) => typeof (node as { address?: unknown })?.address === 'string'
      ? [(node as { address: string }).address.trim()] : [])
  })
  return [...new Set(hosts.filter(Boolean))]
}
```

Read JSON with `readFile`, leave IPv4 literals unchanged, resolve names by `lookup(host, { family: 4 })`, and deduplicate by the final address while retaining its first host label.

- [ ] **Step 4: Run `npm test -- tests/unit/xrayBypassTargets.test.ts && npm run typecheck`; expect PASS.**
- [x] **Step 5: Commit `feat: read VPN bypass targets from Xray config`.**

### Task 2: Reconcile only TradeTools-owned Windows routes

**Files:** Modify `src/main/services/proxies/vpnBypassRoutes.ts`; modify `tests/unit/proxyChainSetup.test.ts`.

**Consumes:** `XrayBypassTarget`, `localXrayConfigPath`, and `resolveXrayBypassTargets` from Task 1.

**Produces:** `VpnBypassStatus`, non-elevated inspection, config-based routing and `%APPDATA%/tradetools/vpn-bypass/routes.json` with only successfully managed routes.

- [ ] **Step 1: Write failing script tests for managed replacement and an unrecorded foreign route.**

```ts
it('replaces only a route recorded as managed by TradeTools', () => {
  const script = createWindowsVpnBypassRouteScript({
    targets: [{ host: 'entry.example', address: '198.51.100.10' }],
    managedRoutes: [{ address: '198.51.100.10', gateway: '192.168.1.1', interfaceIndex: 5 }], outputPath: 'C:\\TradeTools\\result.json'
  })
  expect(script).toContain('route.exe DELETE $target.address')
  expect(script).toContain('Persistent route обновлён мимо VPN')
})
it('does not overwrite a route absent from the registry', () => {
  const script = createWindowsVpnBypassRouteScript({ targets: [{ host: 'entry', address: '198.51.100.10' }], managedRoutes: [], outputPath: 'C:\\TradeTools\\result.json' })
  expect(script).toContain('Не перезаписываю чужой маршрут автоматически')
})
```

- [ ] **Step 2: Run `npm test -- tests/unit/proxyChainSetup.test.ts`; expect the new assertions to fail.**

- [ ] **Step 3: Add registry-backed route decisions.**

```ts
export type ManagedVpnBypassRoute = { address: string; gateway: string; interfaceIndex: number }
type ManagedVpnBypassRouteFile = { version: 1; routes: ManagedVpnBypassRoute[] }
```

Select only an `Up` non-TUN adapter with IPv4 default gateway. For every target: retain a matching physical route; add a missing one; delete then add only a route matching the persisted `{ address, gateway, interfaceIndex }`; otherwise return the existing foreign-route warning. Save only route records returned as added or updated. `configureVpnBypassRoutes` becomes:

```ts
export const configureVpnBypassRoutes = async ({ appDataDir, configPath = localXrayConfigPath(appDataDir) }: {
  appDataDir: string; configPath?: string
}): Promise<VpnBypassRouteResult> => {
  const targets = await resolveXrayBypassTargets(configPath)
  // load routes.json, call the elevated script only for missing/stale owned routes, save returned ownership
}
```

- [ ] **Step 4: Add `inspectVpnBypassState` without elevation.** It resolves targets, reads current adapter/default-gateway and `/32` routes, then returns exact states: `not-required` with `VPN/TUN не обнаружен: обход не требуется`, `protected`, `needs-uac`, or `attention` with `Не найден обычный Wi-Fi/Ethernet gateway`. It must never call `Start-Process -Verb RunAs`.
- [ ] **Step 5: Run `npm test -- tests/unit/proxyChainSetup.test.ts tests/unit/xrayBypassTargets.test.ts && npm run typecheck`; expect PASS.**
- [x] **Step 6: Commit `feat: safely reconcile managed VPN bypass routes`.**

### Task 3: Monitor route changes and avoid repeated UAC

**Files:** Create `src/main/services/proxies/vpnBypassMonitor.ts`; create `tests/unit/vpnBypassMonitor.test.ts`.

**Consumes:** `inspectVpnBypassState` and `configureVpnBypassRoutes` from Task 2.

**Produces:** `VpnBypassMonitor` with one serialized refresh loop.

- [ ] **Step 1: Write failing fake-timer tests.**

```ts
it('suppresses cancelled UAC until the fingerprint changes', async () => {
  const inspect = vi.fn().mockResolvedValueOnce({ ...needsUac, fingerprint: 'wifi-1' })
    .mockResolvedValueOnce({ ...needsUac, fingerprint: 'wifi-1' }).mockResolvedValueOnce({ ...needsUac, fingerprint: 'wifi-2' })
  const configure = vi.fn().mockRejectedValue(new Error('UAC мог быть отменён пользователем'))
  const monitor = createVpnBypassMonitor({ appDataDir, configPath, intervalMs: 15_000, onStatus, inspect, configure })
  await monitor.start(); await vi.advanceTimersByTimeAsync(30_000)
  expect(configure).toHaveBeenCalledTimes(2)
})
it('does not schedule checks after stop', async () => {
  const monitor = createVpnBypassMonitor({ appDataDir, configPath, intervalMs: 15_000, onStatus, inspect, configure })
  await monitor.start(); monitor.stop(); await vi.advanceTimersByTimeAsync(30_000)
  expect(inspect).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run `npm test -- tests/unit/vpnBypassMonitor.test.ts`; expect module-resolution failure.**
- [ ] **Step 3: Implement `createVpnBypassMonitor`.** Use optional injected `inspect` and `configure` only in tests; production defaults are Task 2 functions. `start()` awaits a first `refresh()` and starts `setInterval(() => void refresh(), intervalMs ?? 15_000)`. `refresh()` coalesces concurrent calls, emits `checking`, and invokes elevation only for `needs-uac` with a new fingerprint. A UAC-cancel error stores `dismissedFingerprint`, emits `attention`, and does not retry until a new fingerprint; `refresh({ force: true })` clears that suppression for the current fingerprint. After a successful update, inspect again and publish its verified status. `stop()` clears the timer and prevents late status publication.
- [ ] **Step 4: Run `npm test -- tests/unit/vpnBypassMonitor.test.ts && npm run typecheck`; expect PASS.**
- [x] **Step 5: Commit `feat: monitor VPN bypass while proxy runs`.**

### Task 4: Connect safely and manage monitor lifecycle in Electron

**Files:** Modify `src/main/services/proxies/xrayLocalRuntime.ts`, `src/main/services/proxies/proxyChainSetup.ts`, `src/main/app.ts`, `src/preload/index.ts`, and `tests/unit/appLifecycle.test.ts`.

**Consumes:** Tasks 1–3 and saved runtime UUID in keychain.

**Produces:** `proxies:connect-chain`, `proxies:get-vpn-bypass-status`, `proxies:refresh-vpn-bypass`, and event `proxies:vpn-bypass-status`.

- [ ] **Step 1: Write failing lifecycle/preload assertions.**

```ts
expect(appSource).toContain('vpnBypassMonitor.start()')
expect(appSource).toContain('vpnBypassMonitor.stop()')
expect(appSource).toContain("'proxies:refresh-vpn-bypass'")
expect(preloadSource).toContain('connectChain')
expect(preloadSource).toContain('onVpnBypassStatus')
```

- [ ] **Step 2: Run `npm test -- tests/unit/appLifecycle.test.ts`; expect failure.**
- [ ] **Step 3: Export and reuse `localXrayConfigPath`.** Replace the local config `join(...)` in `setupLocalXrayRuntime` with the Task 1 helper.
- [ ] **Step 4: Implement `reconnectStoredProxyRuntime` in `proxyChainSetup.ts`.** It calls `setupLocalXrayRuntime` with persisted host/port/UUID, runs `inspectProxyNetworkEnvironment`, and returns `ProxyChainSetupResult & { reusedRuntime: true }`. It performs no SSH operation. `setupProxyChainOnServers` returns the same result with `reusedRuntime: false`.
- [ ] **Step 5: Add a single `vpnBypassMonitor` in `app.whenReady()`.** After saved runtime startup or either branch of the new connect IPC succeeds, stop an earlier monitor, create one with `app.getPath('userData')` and `localXrayConfigPath`, and await `start()`. Broadcast each status via every current `BrowserWindow.webContents.send('proxies:vpn-bypass-status', status)`. Stop it in `before-quit`.
- [ ] **Step 6: Add `connect-chain` IPC.** When `proxyRuntime.entryUuidConfigured`, `activeStartProxyId === proxyId`, and its keychain UUID exists, call `reconnectStoredProxyRuntime`; otherwise call the current server setup routine. Both branches start the monitor. Keep `setup-chain` temporarily for compatibility, but the UI must use `connect-chain`.
- [ ] **Step 6a: Add bypass IPC.** `proxies:get-vpn-bypass-status` returns the monitor's cached status or an `idle` status. `proxies:refresh-vpn-bypass` calls `vpnBypassMonitor.refresh({ force: true })` so the visible «Обновить VPN bypass» button may retry after a cancelled UAC.
- [ ] **Step 7: Expose narrow preload methods:**

```ts
connectChain: (input: { proxyId: string }): Promise<ProxyChainConnectionResult>
getVpnBypassStatus: (): Promise<VpnBypassStatus>
refreshVpnBypass: (): Promise<VpnBypassStatus>
onVpnBypassStatus: (callback: (status: VpnBypassStatus) => void): (() => void)
```

Implement the event cleanup with a named listener and `ipcRenderer.removeListener`, matching current progress subscriptions.
- [ ] **Step 8: Run `npm test -- tests/unit/appLifecycle.test.ts tests/unit/proxyChainSetup.test.ts && npm run typecheck`; expect PASS.**
- [x] **Step 9: Commit `feat: connect proxy and monitor VPN bypass automatically`.**

### Task 5: Deliver the connection-first proxy UI

**Files:** Create `src/renderer/components/settings/proxyConnectionState.ts`, `tests/unit/proxyConnectionState.test.ts`; modify `src/renderer/components/settings/ProxyVaultPanel.tsx` and `tests/unit/dashboardLayout.test.ts`.

**Consumes:** `ProxyChainConnectionResult` and `VpnBypassStatus` from Task 4.

**Produces:** compact connection card and hidden-by-default technical diagnostics.

- [ ] **Step 1: Write failing pure presentation tests.**

```ts
expect(createProxyConnectionSummary({ connection: { ...connection, reusedRuntime: true }, bypass: { ...bypass, state: 'protected' }, activeOperation: undefined }))
  .toMatchObject({ title: 'Прокси подключён', bypassLabel: 'VPS идёт напрямую' })
expect(createProxyConnectionSummary({ connection, bypass: { ...bypass, state: 'needs-uac' }, activeOperation: undefined }).title)
  .toBe('Прокси подключён')
```

- [ ] **Step 2: Run `npm test -- tests/unit/proxyConnectionState.test.ts`; expect module-resolution failure.**
- [ ] **Step 3: Implement the model.**

```ts
export type ProxyConnectionSummary = {
  title: 'Прокси подключён' | 'Подключаем прокси' | 'Прокси не подключён'
  tone: 'success' | 'info' | 'neutral'
  bypassLabel: string
  bypassTone: 'success' | 'warning' | 'neutral'
}
```

Map `protected` to `VPS идёт напрямую`, `not-required` to `VPN bypass не требуется`, `needs-uac` to `Требуется подтверждение Windows`, and `attention` to `Требуется внимание`. Never expose raw PowerShell text here.
- [ ] **Step 4: Restructure `ProxyVaultPanel`.** Add `connectionResult`, `vpnBypassStatus`, and operation `'connect'` to state. Subscribe on mount to `onVpnBypassStatus` and fetch initial status; clean up on unmount. Add a top `Подключение` card with summary, route, `HTTP 127.0.0.1:<port>`, last bypass check, primary `Подключить прокси`, secondary `Проверить подключение`, and `Обновить VPN bypass` only in `needs-uac`/`attention`. The primary calls `connectChain`; the secondary retains the existing read-only `configureChain` handler.
- [ ] **Step 5: Move verbose content.** Wrap progress arrays, SSH results, network diagnostics, `VpnBypassResultBlock`, and raw messages in `<details><summary>Диагностика</summary>…</details>` closed by default. Wrap existing forms, list, ordering and server buttons in `<details open><summary>Серверы цепочки</summary>…</details>`. During normal operation the top card shows only `Подключаем прокси…` or `Проверяем подключение…`, not post-step rows.
- [ ] **Step 6: Run `npm test -- tests/unit/proxyConnectionState.test.ts tests/unit/dashboardLayout.test.ts && npm run typecheck`; expect PASS.** Add source assertions for `Подключить прокси`, `Проверить подключение`, and `<details` if no existing proxy UI assertion exists.
- [x] **Step 7: Commit `feat: simplify proxy connection interface`.**

### Task 6: Document and verify the release

**Files:** Modify `docs/USER_GUIDE_RU.md`, `tests/unit/proxyChainSetup.test.ts`, and `tests/unit/appLifecycle.test.ts`.

- [ ] **Step 1: Replace the manual bypass text with:**

```md
Нажмите «Подключить прокси». TradeTools запускает локальный HTTP proxy и проверяет прямой маршрут к входному VPS. При смене Wi-Fi/Ethernet, gateway или TUN-клиента проверка повторяется автоматически. Если маршруту нужны права Windows, подтвердите UAC; настройки терминала менять не нужно.

«Проверить подключение» только проверяет SSH и сеть. Подробные сообщения доступны в разделе «Диагностика».
```

Keep the terminal guidance `HTTP 127.0.0.1:<порт>` and state that other VPN routes are untouched.
- [ ] **Step 2: Run `npm test && npm run build`; expect all suites, TypeScript, and electron-vite to pass.**
- [ ] **Step 3: Perform Windows validation:** configure a chain, connect twice (second call must reuse runtime without SSH progress), switch Happ then v2RayTun, wait up to 15 seconds, confirm UAC only when a route is missing/stale, and verify `route print <entry VPS>` uses Wi-Fi/Ethernet. Cancel UAC and wait 30 seconds to confirm no duplicate prompt until a new network/TUN fingerprint or `Обновить VPN bypass`.
- [ ] **Step 4: Commit `docs: explain automatic proxy VPN bypass`.**

## Plan self-review

- Coverage: Tasks 1–3 cover Xray-derived targeting, neutral Happ/v2RayTun monitoring, owned-route protection, 15-second checks and UAC suppression. Task 4 covers startup/reconnect/IPC lifecycle. Task 5 covers connection-first UI and separate read-only check. Task 6 covers docs and full verification.
- Placeholder scan: no unresolved placeholders, deferred implementation, or unspecified test command remains.
- Type consistency: Task 1 defines `XrayBypassTarget`; Task 2 defines status/reconciler; Task 3 consumes them; Task 4 exposes them; Task 5 consumes those exact types.
