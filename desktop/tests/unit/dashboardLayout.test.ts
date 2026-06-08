import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Dashboard layout', () => {
  it('splits the app into video and proxy pages instead of sidebar anchor tabs', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const sidebarSource = await readFile(resolve('src/renderer/components/layout/Sidebar.tsx'), 'utf8')

    expect(sidebarSource).toContain("page: 'video'")
    expect(sidebarSource).toContain("page: 'proxy'")
    expect(sidebarSource).not.toContain('scrollIntoView')
    expect(sidebarSource).not.toContain('Очередь клипов')
    expect(sidebarSource).not.toContain('Интеграции')
    expect(sidebarSource).not.toContain('Настройки')
    expect(dashboardSource).toContain("activePage === 'video'")
    expect(dashboardSource).toContain('<ProxyPage')
  })

  it('keeps video controls on the video page', async () => {
    const source = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(source.indexOf('Очередь проверки')).toBeLessThan(source.indexOf('<ObsSettingsPanel'))
    expect(source).not.toContain('Клипы остаются локально')
    expect(source).not.toContain('Пока нет локальных клипов')
    expect(source).toContain('<BinanceFuturesSettingsPanel')
    expect(source).toContain('mode="video"')
    expect(source).not.toContain('ActiveTradeCard')
    expect(source).not.toContain('Пайплайн клипа')
  })

  it('does not show a separate clip review status badge', async () => {
    const clipCardSource = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')

    expect(clipCardSource).not.toContain('На проверке')
  })

  it('allows renaming queued clip video files', async () => {
    const clipCardSource = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(clipCardSource).toContain('Переименовать файл')
    expect(clipCardSource).toContain('clips.renameFile')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:rename-file'")
    expect(appSource).toContain("ipcMain.handle('clips:rename-file'")
  })

  it('opens clip preview from the preview artwork', async () => {
    const clipCardSource = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')

    expect(clipCardSource).toContain('aria-label="Открыть предпросмотр клипа"')
    expect(clipCardSource).toContain('onClick={() => void openPreview()}')
  })

  it('wires the top notification button to a system notification test', async () => {
    const topBarSource = await readFile(resolve('src/renderer/components/layout/TopBar.tsx'), 'utf8')
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(topBarSource).toContain('onTestNotification')
    expect(topBarSource).toContain('Проверить системное уведомление')
    expect(topBarSource).toContain('Мастер настройки видео')
    expect(topBarSource).toContain('Мастер настройки прокси')
    expect(topBarSource).toContain('text-amber-300')
    expect(dashboardSource).toContain('notifications.test()')
  })

  it('lets the proxy setup wizard save two servers and run the setup chain', async () => {
    const source = await readFile(resolve('src/renderer/components/setup/SetupWizard.tsx'), 'utf8')

    expect(source).toContain('secondProxyServer')
    expect(source).toContain('Сохранить два сервера и связку')
    expect(source).toContain('setSavedWizardProxyIds([firstProxy.id, secondProxy.id])')
    expect(source).toContain('proxies.setupChain({ proxyId: selectedProxyId })')
    expect(source).toContain('Настроить и запустить связку')
  })

  it('keeps proxy controls on the proxy page', async () => {
    const source = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(source).toContain('<ProxyVaultPanel')
    expect(source).toContain('mode="proxy"')
    expect(source).toContain('SSH-проверку')
    expect(source).not.toContain('инструкции Throne')
  })

  it('uses a separate draggable proxy chain order instead of next-server form fields', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const panelSource = await readFile(resolve('src/renderer/components/settings/ProxyVaultPanel.tsx'), 'utf8')
    const wizardSource = await readFile(resolve('src/renderer/components/setup/setupWizardSteps.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(panelSource).toContain('Порядок связки')
    expect(panelSource).toContain('draggable')
    expect(panelSource).toContain('Сохранить порядок')
    expect(panelSource).toContain('Настроить и запустить')
    expect(panelSource).toContain('Проверка связки')
    expect(dashboardSource).toContain('onConfigureChainProgress')
    expect(panelSource).toContain('Прогресс настройки')
    expect(preloadSource).toContain('proxies:configure-chain-progress')
    expect(panelSource).toContain('Если пинг выше ожидаемого')
    expect(panelSource).toContain('split tunneling')
    expect(panelSource).toContain('VPN и маршрут')
    expect(panelSource).toContain('Обойти VPN для VPS')
    expect(panelSource).toContain('configureVpnBypass')
    expect(preloadSource).toContain('proxies:configure-vpn-bypass')
    expect(panelSource).not.toContain('chainResult.throne')
    expect(panelSource).not.toContain('Следующий сервер в связке')
    expect(wizardSource).toContain('первым сервером через второй сервер')
    expect(wizardSource).not.toContain('Следующий сервер в связке')
  })

  it('keeps proxy setup progress in the mounted dashboard while switching pages', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const panelSource = await readFile(resolve('src/renderer/components/settings/ProxyVaultPanel.tsx'), 'utf8')

    expect(dashboardSource).toContain('proxyVaultRuntime')
    expect(dashboardSource).toContain('appendProxyProgress')
    expect(dashboardSource).toContain('onSetupChainProgress')
    expect(dashboardSource).toContain('onRuntimeStateChange={setProxyVaultRuntime}')
    expect(panelSource).toContain('runtimeState: ProxyVaultRuntimeState')
    expect(panelSource).not.toContain('const [chainSetupProgress')
    expect(panelSource).not.toContain('const [chainCheckProgress')
  })

  it('refreshes the clip queue while Binance watcher works in the main process', async () => {
    const source = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(source).toContain('refreshPendingClips')
    expect(source).toContain('setInterval')
    expect(source).toContain('api.clips.listPending()')
  })

  it('surfaces Binance watcher status instead of leaving background failures invisible', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(dashboardSource).toContain('api.binance.getWatchStatus()')
    expect(dashboardSource).toContain('binanceWatch')
    expect(preloadSource).toContain("ipcRenderer.invoke('binance:get-watch-status')")
  })

  it('auto-saves system toggle changes instead of waiting for a restart-prone form save', async () => {
    const source = await readFile(resolve('src/renderer/components/settings/SystemSettingsPanel.tsx'), 'utf8')

    expect(source).toContain('toggleLaunchAtLogin')
    expect(source).toContain('Автозапуск включён')
    expect(source).toContain('void toggleLaunchAtLogin(event.target.checked)')
    expect(source).toContain('void toggleClipSuccessNotifications(event.target.checked)')
    expect(source).toContain('void toggleProxyPaymentNotifications(event.target.checked)')
  })
})
