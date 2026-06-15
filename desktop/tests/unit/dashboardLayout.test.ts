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
    expect(source).not.toContain('BinanceFuturesSettingsPanel')
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

  it('allows deleting queued clip video files', async () => {
    const clipCardSource = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(clipCardSource).toContain('Удалить файл')
    expect(clipCardSource).toContain('clips.deleteFile')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:delete-file'")
    expect(appSource).toContain("ipcMain.handle('clips:delete-file'")
  })

  it('supports built-in terminal window recording without requiring OBS', async () => {
    const settingsPanelSource = await readFile(resolve('src/renderer/components/settings/ObsSettingsPanel.tsx'), 'utf8')
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(settingsPanelSource).toContain('Встроенная запись')
    expect(settingsPanelSource).toContain('sourceType')
    expect(settingsPanelSource).toContain('Экран')
    expect(appSource).toContain("types: ['window', 'screen']")
    expect(settingsPanelSource).toContain('listWindowSources')
    expect(settingsPanelSource).toContain('Пресет 10 минут до / 2 минуты после')
    expect(settingsPanelSource).toContain('Буфер до входа, сек')
    expect(settingsPanelSource).toContain('Размер одного куска записи')
    expect(settingsPanelSource).toContain('Звук с ПК')
    expect(settingsPanelSource).not.toContain('Звук компьютера')
    expect(settingsPanelSource).toContain('Микрофон')
    expect(settingsPanelSource).toContain('systemAudioEnabled')
    expect(settingsPanelSource).toContain('microphoneEnabled')
    expect(settingsPanelSource).toContain('Сколько секунд видео TradeTools держит до входа')
    expect(settingsPanelSource).toContain('longClipPresetSeconds')
    expect(settingsPanelSource).toContain('longClipAfterExitSeconds')
    expect(controllerSource).toContain('findPreferredTerminalSource')
    expect(controllerSource).toContain('Автоматически выбрали окно терминала')
    expect(controllerSource).toContain('navigator.mediaDevices.getUserMedia')
    expect(controllerSource).toContain('settings.recording.systemAudioEnabled')
    expect(controllerSource).toContain('settings.recording.microphoneEnabled')
    expect(controllerSource).toContain('navigator.mediaDevices.getDisplayMedia')
    expect(controllerSource).toContain("navigator.mediaDevices.getUserMedia({ audio: true, video: false })")
    expect(controllerSource).toContain('new MediaStream')
    expect(controllerSource).toContain('createFixedFrameRateStream')
    expect(controllerSource).toContain('canvas.captureStream')
    expect(controllerSource).toContain('recording.appendSegment')
    expect(dashboardSource).toContain('<WindowRecorderController')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:list-window-sources'")
    expect(appSource).toContain("ipcMain.handle('recording:append-segment'")
    expect(appSource).toContain('windowRecorderService.saveReplayBuffer(input)')
  })

  it('shows one recording status panel with background recording controls', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(dashboardSource).toContain('RecordingStatusPanel')
    expect(dashboardSource).not.toContain('RecorderBufferProgress')
    expect(dashboardSource).not.toContain('TerminalTradeControls')
    expect(dashboardSource).toContain('backgroundRecordingEnabled')
    expect(dashboardSource).toContain('Остановить фоновую запись')
    expect(dashboardSource).toContain('Включить фоновую запись')
    expect(dashboardSource).toContain('recording.stop()')
    expect(controllerSource).toContain('enabled?: boolean')
    expect(controllerSource).toContain('enabled === false')
    expect(dashboardSource).toContain('enabled={backgroundRecordingEnabled}')
    expect(dashboardSource).toContain('Свободная запись')
    expect(dashboardSource).toContain('Записывает выбранное окно или экран без привязки к сделкам.')
    expect(dashboardSource).toContain('recording.startFree()')
    expect(dashboardSource).toContain('recording.pauseFree()')
    expect(dashboardSource).toContain('recording.resumeFree()')
    expect(dashboardSource).toContain('recording.finishFree()')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:free-start'")
    expect(appSource).toContain("ipcMain.handle('recording:free-finish'")
  })

  it('restarts background window recording when main asks during a terminal trade', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(preloadSource).toContain('onEnsureWindowRecording')
    expect(preloadSource).toContain("ipcRenderer.on('recording:ensure-window'")
    expect(dashboardSource).toContain('recordingEnsureKey')
    expect(dashboardSource).toContain('onEnsureWindowRecording')
    expect(dashboardSource).toContain('startBackgroundRecording({ silent: true })')
    expect(dashboardSource).toContain('if (!backgroundRecordingEnabledRef.current) void startBackgroundRecording({ silent: true })')
    expect(dashboardSource).toContain('recordingEnsureKey={recordingEnsureKey}')
    expect(controllerSource).toContain('recordingEnsureKey?: number')
    expect(controllerSource).toContain('recordingEnsureKey')
  })

  it('uses terminal window recording as the default no-API trade source', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const settingsSource = await readFile(resolve('src/main/services/settings/settings.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(settingsSource).toContain("mode: 'terminal-window'")
    expect(dashboardSource).toContain('Автозапись терминалов')
    expect(dashboardSource).toContain('После закрытия TradeTools сам сохранит клип')
    expect(dashboardSource).not.toContain('Начать запись сделки')
    expect(preloadSource).toContain("ipcRenderer.invoke('terminal-trade:get-status'")
    expect(preloadSource).not.toContain("ipcRenderer.invoke('terminal-trade:start'")
    expect(appSource).toContain('createTerminalTradeWatcher')
    expect(appSource).toContain("ipcMain.handle('terminal-trade:get-status'")
    expect(appSource).not.toContain('binance-futures')
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
    expect(topBarSource).toContain('text-amber-200')
    expect(topBarSource).toContain('break-words')
    expect(topBarSource).toContain('xl:max-w-[520px]')
    expect(dashboardSource).toContain('notifications.test()')
  })

  it('shows the TradeCore Telegram badge in the app brand', async () => {
    const sidebarSource = await readFile(resolve('src/renderer/components/layout/Sidebar.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(sidebarSource).toContain('by tradecore')
    expect(sidebarSource).toContain('https://t.me/tradekorr')
    expect(sidebarSource).toContain('links.openExternal')
    expect(preloadSource).toContain("ipcRenderer.invoke('links:open-external'")
    expect(appSource).toContain("ipcMain.handle('links:open-external'")
  })

  it('lets the proxy setup wizard save two servers and run the setup chain', async () => {
    const source = await readFile(resolve('src/renderer/components/setup/SetupWizard.tsx'), 'utf8')

    expect(source).toContain('secondProxyServer')
    expect(source).toContain('Сохранить два сервера и связку')
    expect(source).toContain('setSavedWizardProxyIds([firstProxy.id, secondProxy.id])')
    expect(source).toContain('proxies.setupChain({ proxyId: selectedProxyId })')
    expect(source).toContain('Настроить и запустить связку')
  })

  it('offers a heavy 10 minute video preset in the setup wizard', async () => {
    const source = await readFile(resolve('src/renderer/components/setup/SetupWizard.tsx'), 'utf8')

    expect(source).toContain('Пресет 10 минут до / 2 минуты после')
    expect(source).toContain('Тяжёлый режим')
    expect(source).toContain('Локальный буфер до входа, сек')
    expect(source).toContain('Размер одного куска записи')
    expect(source).toContain('Сколько секунд видео TradeTools держит до входа')
    expect(source).toContain('longClipPresetSeconds')
    expect(source).toContain('longClipAfterExitSeconds')
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

  it('refreshes the clip queue and background clip processing status', async () => {
    const source = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('refreshPendingClips')
    expect(source).toContain('setInterval')
    expect(source).toContain('api.clips.listPending()')
    expect(source).toContain('api.clips.getProcessingStatus()')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:get-processing-status')")
    expect(appSource).toContain("ipcMain.handle('clips:get-processing-status'")
  })

  it('removes Binance API key wiring from the video UI and preload bridge', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(dashboardSource).not.toContain('api.binance')
    expect(dashboardSource).not.toContain('binanceWatch')
    expect(dashboardSource).not.toContain('BinanceFuturesSettingsPanel')
    expect(preloadSource).not.toContain('binance:')
    expect(appSource).not.toContain('binance:')
  })

  it('shows clip processing progress without API watcher state', async () => {
    const source = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(source).toContain('ClipProcessingBar')
    expect(source).toContain('clipProcessing?.active')
    expect(source).toContain('localClipProcessing')
    expect(source).toContain('remoteClipProcessing')
    expect(source).not.toContain('binanceProcessing')
    expect(source).not.toContain('isBinanceWaitingStatus')
  })

  it('auto-saves system toggle changes instead of waiting for a restart-prone form save', async () => {
    const source = await readFile(resolve('src/renderer/components/settings/SystemSettingsPanel.tsx'), 'utf8')

    expect(source).toContain('toggleLaunchAtLogin')
    expect(source).toContain('Автозапуск включён')
    expect(source).toContain('void toggleLaunchAtLogin(event.target.checked)')
    expect(source).toContain('void toggleClipSuccessNotifications(event.target.checked)')
    expect(source).toContain('void toggleProxyPaymentNotifications(event.target.checked)')
  })

  it('wires in-app updates through Electron and release metadata', async () => {
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appShellSource = await readFile(resolve('src/renderer/components/layout/AppShell.tsx'), 'utf8')
    const systemSettingsSource = await readFile(resolve('src/renderer/components/settings/SystemSettingsPanel.tsx'), 'utf8')
    const updateServiceSource = await readFile(resolve('src/main/services/updates/appUpdateService.ts'), 'utf8')
    const releaseWorkflowSource = await readFile(resolve('../.github/workflows/release.yml'), 'utf8')

    expect(appSource).toContain('createAppUpdateService')
    expect(appSource).toContain('hasPackagedUpdateConfig')
    expect(appSource).toContain('isInstalledUpdateBuild')
    expect(appSource).toContain('hasPackagedAppArchive')
    expect(appSource).toContain('isInstalledBuild: isInstalledUpdateBuild()')
    expect(appSource).toContain('onUpdateAvailable')
    expect(appSource).toContain('Вышла новая версия TradeTools')
    expect(appSource).toContain("app-update.yml")
    expect(appSource).toContain("ipcMain.handle('updates:check'")
    expect(preloadSource).toContain("ipcRenderer.invoke('updates:download'")
    expect(preloadSource).toContain("ipcRenderer.on('updates:status'")
    expect(appShellSource).toContain('<UpdateBanner')
    expect(systemSettingsSource).toContain('Проверить обновления')
    expect(updateServiceSource).toContain("import electronUpdater")
    expect(updateServiceSource).toContain('const { autoUpdater } = electronUpdater')
    expect(updateServiceSource).toContain('isInstalledBuild')
    expect(updateServiceSource).toContain('hasUpdateConfig')
    expect(updateServiceSource).toContain('notifiedUpdateVersion')
    expect(updateServiceSource).toContain('onUpdateAvailable?.')
    expect(updateServiceSource).toContain('isPackaged || isInstalledBuild || hasUpdateConfig')
    expect(updateServiceSource).toContain('autoUpdater.forceDevUpdateConfig = true')
    expect(updateServiceSource).toContain('autoUpdater.setFeedURL(githubFeed)')
    expect(updateServiceSource).not.toContain('import { autoUpdater')
    expect(releaseWorkflowSource).toContain('desktop/dist/latest*.yml')
    expect(releaseWorkflowSource).toContain("name '*.blockmap'")
    expect(releaseWorkflowSource).not.toContain('dist:linux')
    expect(releaseWorkflowSource).not.toContain('AppImage')
  })
})
