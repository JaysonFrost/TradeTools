import { motion } from 'framer-motion'
import { Dashboard } from '../../routes/Dashboard'
import { Sidebar } from './Sidebar'

export const AppShell = () => (
  <div className="flex h-screen gap-4 p-4">
    <Sidebar />
    <main className="min-w-0 flex-1 overflow-hidden rounded-[28px] border border-white/[0.06] bg-black/20 p-6">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="h-[calc(100vh-80px)] overflow-auto pr-2">
        <Dashboard />
      </motion.div>
    </main>
  </div>
)
