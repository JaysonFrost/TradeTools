import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Dashboard layout', () => {
  it('keeps the clip review queue above integrations and settings without unused trade cards', async () => {
    const source = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(source.indexOf('Очередь проверки')).toBeLessThan(source.indexOf('id="integrations-section"'))
    expect(source.indexOf('Очередь проверки')).toBeLessThan(source.indexOf('<ObsSettingsPanel'))
    expect(source).not.toContain('ActiveTradeCard')
    expect(source).not.toContain('Пайплайн клипа')
    expect(source).not.toContain('id="trades-section"')
    expect(source).not.toContain('id="pipeline-section"')
  })

  it('keeps Binance Futures keys inside the settings section', async () => {
    const source = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')

    expect(source.indexOf('<BinanceFuturesSettingsPanel')).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('Очередь проверки')).toBeLessThan(source.indexOf('<BinanceFuturesSettingsPanel'))
    expect(source.indexOf('id="settings-section"')).toBeLessThan(source.indexOf('<BinanceFuturesSettingsPanel'))
  })

  it('wires sidebar settings navigation to the settings section', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const sidebarSource = await readFile(resolve('src/renderer/components/layout/Sidebar.tsx'), 'utf8')

    expect(dashboardSource).toContain('id="settings-section"')
    expect(sidebarSource).toContain("targetId: 'settings-section'")
    expect(sidebarSource).toContain('scrollIntoView')
    expect(sidebarSource).not.toContain("targetId: 'trades-section'")
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
})
