import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { AppUpdateStatus } from '../../../main/services/updates/appUpdateService'
import { Dashboard } from '../../routes/Dashboard'
import type { AppPage } from '../../lib/navigation'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { UpdateBanner } from '../updates/UpdateBanner'
import { Sidebar } from './Sidebar'

export const AppShell = () => {
  const [activePage, setActivePage] = useState<AppPage>('video')
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>()

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

  return (
    <div className="flex h-dvh min-h-0 flex-col gap-3 p-3 lg:flex-row lg:gap-4 lg:p-4">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/[0.06] bg-black/20 p-4 lg:rounded-[28px] lg:p-6">
        <UpdateBanner
          status={updateStatus}
          onCheck={() => void runUpdateAction(() => getTradeToolsApi().updates.check())}
          onDownload={() => void runUpdateAction(() => getTradeToolsApi().updates.download())}
          onInstall={() => void runUpdateAction(() => getTradeToolsApi().updates.install())}
        />
        <motion.div
          key={activePage}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="app-scroll min-h-0 flex-1 overflow-auto pr-1 lg:pr-2"
        >
          <Dashboard activePage={activePage} />
        </motion.div>
      </main>
    </div>
  )
}
