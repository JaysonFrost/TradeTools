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

  it('uses the current TRC20 donation address for text, copy and QR code', async () => {
    const supportSource = await readFile(resolve('src/renderer/components/support/SupportDeveloperPage.tsx'), 'utf8')

    expect(supportSource).toContain("address: 'TCikP8GinVFDSkcjoPZeV76wcUkPvtdEgW'")
    expect(supportSource).not.toContain('TGKPUrzVehY2J46RC4T5xEzxhYNbFYE3YV')
    expect(supportSource).toContain('value={wallet.address}')
    expect(supportSource).toContain('writeClipboard(wallet.address)')
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

  it('opens the clip output folder from the review queue header', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const queueSectionSource = dashboardSource.slice(dashboardSource.indexOf('Очередь проверки'))

    expect(queueSectionSource).toContain('Открыть папку с видео')
    expect(queueSectionSource).toContain('onOpenClipFolder')
    expect(dashboardSource).toContain('clips.openOutputFolder()')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:open-output-folder'")
    expect(appSource).toContain("ipcMain.handle('clips:open-output-folder'")
    expect(appSource).toContain('settings.clip.outputDir')
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
    expect(settingsPanelSource).toContain('Кодирование')
    expect(settingsPanelSource).toContain('Видеокарта')
    expect(settingsPanelSource).toContain('Процессор')
    expect(settingsPanelSource).toContain('videoEncoder')
    expect(settingsPanelSource).toContain('systemAudioEnabled')
    expect(settingsPanelSource).toContain('microphoneEnabled')
    expect(settingsPanelSource).toContain('Пресет 2с до / 2с после')
    expect(settingsPanelSource).toContain('defaultReplayBufferSeconds')
    expect(settingsPanelSource).toContain('буфер 60с')
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

  it('supports multi-monitor capture target selection in built-in recording settings', async () => {
    const settingsPanelSource = await readFile(resolve('src/renderer/components/settings/ObsSettingsPanel.tsx'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(settingsPanelSource).toContain('captureTargets')
    expect(settingsPanelSource).toContain('saveTargetMode')
    expect(settingsPanelSource).toContain('saveTargetId')
    expect(settingsPanelSource).toContain('saveTradeDisplayOnly')
    expect(settingsPanelSource).toContain('Только монитор сделки')
    expect(settingsPanelSource).toContain('Все мониторы')
    expect(settingsPanelSource).toContain('Выбранный монитор')
    expect(settingsPanelSource).toContain('Мониторы для записи')
    expect(controllerSource).toContain('resolveRecordingTargets')
    expect(controllerSource).toContain('settings.recording.captureTargets')
  })

  it('auto-saves video settings and refreshes window sources every minute', async () => {
    const settingsPanelSource = await readFile(resolve('src/renderer/components/settings/ObsSettingsPanel.tsx'), 'utf8')

    expect(settingsPanelSource).toContain('saveCurrentSettings')
    expect(settingsPanelSource).toContain('window.setInterval')
    expect(settingsPanelSource).toContain('60_000')
    expect(settingsPanelSource).toContain('Настройки применены')
    expect(settingsPanelSource).not.toContain('Нажмите «Сохранить»')
    expect(settingsPanelSource).not.toContain("{saving ? 'Сохраняем...' : 'Сохранить'}")
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

  it('shows finished free recordings in the review queue and has bulk queue actions', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const pipelineSource = await readFile(resolve('src/main/services/trades/tradeClipPipeline.ts'), 'utf8')

    expect(dashboardSource).toContain('onClearQueue')
    expect(dashboardSource).toContain('onDeleteQueueFiles')
    expect(dashboardSource).toContain('Очистить очередь')
    expect(dashboardSource).toContain('Удалить все файлы')
    expect(dashboardSource).toContain('Свободная запись добавлена в очередь')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:clear-queue'")
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:delete-queue-files'")
    expect(appSource).toContain('clipPipeline.addFreeRecordingToQueue')
    expect(appSource).toContain("ipcMain.handle('clips:clear-queue'")
    expect(appSource).toContain("ipcMain.handle('clips:delete-queue-files'")
    expect(pipelineSource).toContain('addFreeRecordingToQueue')
    expect(pipelineSource).toContain('clearQueue')
    expect(pipelineSource).toContain('deleteQueueFiles')
  })

  it('lets users save the latest buffer manually and cancel clip rendering', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(dashboardSource).toContain('Сохранить последний буфер')
    expect(dashboardSource).not.toContain('Создать тестовый клип')
    expect(dashboardSource).toContain('manualBufferTargetId')
    expect(dashboardSource).toContain('clips.createBuffer')
    expect(dashboardSource).toContain('clips.cancelRender')
    expect(dashboardSource).toContain('Отменить')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:create-buffer'")
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:cancel-render'")
    expect(appSource).toContain("ipcMain.handle('clips:create-buffer'")
    expect(appSource).toContain("ipcMain.handle('clips:cancel-render'")
  })

  it('places manual buffer saving next to background recording controls', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const recordingPanelStart = dashboardSource.indexOf('const RecordingStatusPanel')
    const freeRecordingStart = dashboardSource.indexOf('const FreeRecordingControls')
    const recordingPanelSource = dashboardSource.slice(recordingPanelStart, freeRecordingStart)
    const queueSectionSource = dashboardSource.slice(dashboardSource.indexOf('Очередь проверки'))

    expect(recordingPanelSource).toContain('Сохранить последний буфер')
    expect(recordingPanelSource).toContain('onCreateBuffer')
    expect(recordingPanelSource).toContain('manualBufferTargetId')
    expect(recordingPanelSource.indexOf('Сохранить последний буфер')).toBeGreaterThan(recordingPanelSource.indexOf('Остановить фоновую запись'))
    expect(queueSectionSource).not.toContain('Сохранить последний буфер')
  })

  it('keeps the clip queue to about four visible items with scrolling for the rest', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const queueSectionSource = dashboardSource.slice(dashboardSource.indexOf('Очередь проверки'))

    expect(queueSectionSource).toContain('max-h-[560px]')
    expect(queueSectionSource).toContain('overflow-y-auto')
  })

  it('makes free recording finish immediately instead of pausing first', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const freeRecordingSource = dashboardSource.slice(
      dashboardSource.indexOf('const FreeRecordingControls'),
      dashboardSource.indexOf('const DiagnosticsLogPanel')
    )

    expect(freeRecordingSource).toContain('Завершить')
    expect(freeRecordingSource).not.toContain('Закончить')
    expect(freeRecordingSource.indexOf('onClick={onFinish}')).toBeLessThan(freeRecordingSource.indexOf('onClick={onPause}'))
  })

  it('does not show noisy background recorder messages while waiting for a trade', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(dashboardSource).not.toContain("windowRecorder?.message ??")
    expect(dashboardSource).not.toContain("'Ждёт окно'")
    expect(dashboardSource).not.toContain('Ожидаем сделку в Vataga, TigerTrade или MetaScalp.')
    expect(dashboardSource).toContain('terminalTrade.active')
    expect(dashboardSource).toContain('Пишем сделку')
  })

  it('keeps the active trade stats compact instead of repeating the long status message', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const recordingPanelSource = dashboardSource.slice(
      dashboardSource.indexOf('const RecordingStatusPanel'),
      dashboardSource.indexOf('const FreeRecordingControls')
    )

    expect(recordingPanelSource).toContain('const activeTradeSummary')
    expect(recordingPanelSource).toContain('Сделки: <span className="text-zinc-300">{activeTradeSummary}</span>')
    expect(recordingPanelSource).not.toContain('Сделки: <span className="text-zinc-300">{terminalStatus}</span>')
  })

  it('restarts background window recording only when main asks while background recording is enabled', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(preloadSource).toContain('onEnsureWindowRecording')
    expect(preloadSource).toContain("ipcRenderer.on('recording:ensure-window'")
    expect(dashboardSource).toContain('recordingEnsureKey')
    expect(dashboardSource).toContain('onEnsureWindowRecording')
    expect(dashboardSource).toContain('startBackgroundRecording({ silent: true })')
    expect(dashboardSource).toContain('if (backgroundRecordingEnabledRef.current) void startBackgroundRecording({ silent: true })')
    expect(dashboardSource).not.toContain('if (!backgroundRecordingEnabledRef.current) void startBackgroundRecording({ silent: true })')
    expect(dashboardSource).toContain('recordingEnsureKey={recordingEnsureKey}')
    expect(controllerSource).toContain('recordingEnsureKey?: number')
    expect(controllerSource).toContain('recordingEnsureKey')
  })

  it('checks a saved window source before showing ffmpeg startup status', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('isSavedWindowSourceMissing')
    expect(controllerSource.indexOf('isSavedWindowSourceMissing')).toBeLessThan(controllerSource.indexOf('Запускаем оптимизированную ffmpeg-запись'))
    expect(controllerSource).toContain('scheduleSourceRetry(start)')
    expect(controllerSource).toContain('Окно ${settings.recording.windowSourceName} не найдено')
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

    expect(source).toContain('Пресет 2с до / 2с после')
    expect(source).toContain('defaultReplayBufferSeconds')
    expect(source).toContain('буфер 60с')
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
    expect(source).toContain("const nextWindowRecorder = nextSettings.recording.mode === 'window' && !backgroundRecordingEnabledRef.current")
    expect(source).toContain("const nextWindowRecorder = currentSettings.recording.mode === 'window' && !backgroundRecordingEnabledRef.current")
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:get-processing-status')")
    expect(appSource).toContain("ipcMain.handle('clips:get-processing-status'")
  })

  it('shows collapsed logs and lets users copy text or open the log file', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(dashboardSource).toContain('DiagnosticsLogPanel')
    expect(dashboardSource).toContain('<details')
    expect(dashboardSource).toContain('<summary')
    expect(dashboardSource).toContain('Логи')
    expect(dashboardSource).not.toContain('Диагностика')
    expect(dashboardSource).toContain('logs.get()')
    expect(dashboardSource).toContain('clipboard.writeText(logs.text)')
    expect(dashboardSource).toContain('logs.showFile()')
    expect(preloadSource).toContain("ipcRenderer.invoke('logs:get'")
    expect(preloadSource).toContain("ipcRenderer.invoke('logs:show-file'")
    expect(appSource).toContain("ipcMain.handle('logs:get'")
    expect(appSource).toContain("ipcMain.handle('logs:show-file'")
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

  it('keeps clip cards free of the source badge', async () => {
    const source = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')

    expect(source).not.toContain('clip.captureTarget?.name')
    expect(source).not.toContain('Источник:')
  })

  it('auto-saves system toggle changes instead of waiting for a restart-prone form save', async () => {
    const source = await readFile(resolve('src/renderer/components/settings/SystemSettingsPanel.tsx'), 'utf8')

    expect(source).toContain('toggleLaunchAtLogin')
    expect(source).toContain('toggleAlwaysOnTop')
    expect(source).toContain('toggleKeepProxyRunningAfterClose')
    expect(source).toContain('Поверх окон')
    expect(source).toContain('Оставлять proxy после закрытия')
    expect(source).toContain('Автозапуск включён')
    expect(source).toContain('void toggleLaunchAtLogin(event.target.checked)')
    expect(source).toContain('void toggleAlwaysOnTop(event.target.checked)')
    expect(source).toContain('void toggleKeepProxyRunningAfterClose(event.target.checked)')
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
