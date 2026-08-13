import { useEffect, useState } from 'react'
import type { AppUpdateStatus } from '../../../main/services/updates/appUpdateService'
import type { InterfaceTheme } from '../../../main/services/settings/settings'
import { Dashboard } from '../../routes/Dashboard'
import type { AppPage } from '../../lib/navigation'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { applyInterfaceTheme, readStoredInterfaceTheme, rememberInterfaceTheme } from '../../lib/interfaceTheme'
import { UpdateBanner } from '../updates/UpdateBanner'
import { Sidebar } from './Sidebar'

const blueprintShellStyle = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  backgroundColor: '#0b1623',
  backgroundImage: [
    'linear-gradient(rgba(88, 215, 255, 0.08) 1px, transparent 1px)',
    'linear-gradient(90deg, rgba(88, 215, 255, 0.08) 1px, transparent 1px)',
    'linear-gradient(rgba(28, 43, 58, 0.28) 1px, transparent 1px)',
    'linear-gradient(90deg, rgba(28, 43, 58, 0.28) 1px, transparent 1px)'
  ].join(', '),
  backgroundSize: '32px 32px, 32px 32px, 8px 8px, 8px 8px'
}

const classicShellStyle = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  background: 'transparent'
}

export const AppShell = () => {
  const [activePage, setActivePage] = useState<AppPage>('video')
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>()
  const [interfaceTheme, setInterfaceTheme] = useState<InterfaceTheme>(readStoredInterfaceTheme)

  useEffect(() => {
    applyInterfaceTheme(interfaceTheme)
  }, [interfaceTheme])

  useEffect(() => {
    let cancelled = false
    try {
      void getTradeToolsApi().settings.get().then((settings) => {
        if (cancelled) return
        const savedTheme = settings.system.interfaceTheme
        setInterfaceTheme(savedTheme)
        rememberInterfaceTheme(savedTheme)
      }).catch(() => undefined)
    } catch {
      // The settings endpoint is unavailable only outside Electron.
    }
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    try {
      const api = getTradeToolsApi()
      void api.updates.getStatus().then(setUpdateStatus)
      unsubscribe = api.updates.onStatus(setUpdateStatus)
    } catch {
      // Dashboard already surfaces missing Electron API errors.
    }

    return () => unsubscribe?.()
  }, [])

  const runUpdateAction = async (action: () => Promise<AppUpdateStatus> | AppUpdateStatus) => {
    try {
      setUpdateStatus(await action())
    } catch (error) {
      setUpdateStatus({
        status: 'error',
        currentVersion: updateStatus?.currentVersion ?? '',
        message: error instanceof Error ? error.message : 'Не удалось выполнить действие обновления'
      })
    }
  }

  const changeInterfaceTheme = async (theme: InterfaceTheme) => {
    if (theme === interfaceTheme) return
    const previousTheme = interfaceTheme
    applyInterfaceTheme(theme)
    setInterfaceTheme(theme)
    rememberInterfaceTheme(theme)
    try {
      const savedSettings = await getTradeToolsApi().settings.update({ system: { interfaceTheme: theme } })
      rememberInterfaceTheme(savedSettings.system.interfaceTheme)
    } catch {
      applyInterfaceTheme(previousTheme)
      setInterfaceTheme(previousTheme)
      rememberInterfaceTheme(previousTheme)
    }
  }

  return (
    <div
      className="blueprint-frame relative flex h-full min-h-[100dvh] max-h-[100dvh] flex-col gap-3 overflow-hidden p-3 text-[#f0f0f0] lg:flex-row lg:gap-4 lg:p-4"
      style={interfaceTheme === 'classic' ? classicShellStyle : blueprintShellStyle}
    >
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        interfaceTheme={interfaceTheme}
        onInterfaceThemeChange={changeInterfaceTheme}
      />
      <main className="classic-rounded relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-[#294155] bg-[#0b1623]/95 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.28)] lg:p-6">
        <UpdateBanner
          status={updateStatus}
          onCheck={() => void runUpdateAction(() => getTradeToolsApi().updates.check())}
          onDownload={() => void runUpdateAction(() => getTradeToolsApi().updates.download())}
          onInstall={() => void runUpdateAction(() => getTradeToolsApi().updates.install())}
        />
        <div className="app-scroll min-h-0 flex-1 overflow-auto pr-1 lg:pr-2">
          <Dashboard activePage={activePage} />
        </div>
      </main>
    </div>
  )
}
