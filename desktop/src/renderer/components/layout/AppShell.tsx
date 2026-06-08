import { motion } from 'framer-motion'
import { useState } from 'react'
import { Dashboard } from '../../routes/Dashboard'
import type { AppPage } from '../../lib/navigation'
import { Sidebar } from './Sidebar'

export const AppShell = () => {
  const [activePage, setActivePage] = useState<AppPage>('video')

  return (
    <div className="flex h-dvh min-h-0 flex-col gap-3 p-3 lg:flex-row lg:gap-4 lg:p-4">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-[24px] border border-white/[0.06] bg-black/20 p-4 lg:rounded-[28px] lg:p-6">
        <motion.div
          key={activePage}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="h-full overflow-auto pr-1 lg:pr-2"
        >
          <Dashboard activePage={activePage} />
        </motion.div>
      </main>
    </div>
  )
}
