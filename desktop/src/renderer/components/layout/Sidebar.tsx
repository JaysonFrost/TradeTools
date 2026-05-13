import { motion } from 'framer-motion'
import { BarChart3, Clapperboard, CloudUpload, LayoutDashboard, Settings, WalletCards } from 'lucide-react'
import { clsx } from 'clsx'

const items = [
  { label: 'Панель', icon: LayoutDashboard, active: true },
  { label: 'Сделки', icon: BarChart3 },
  { label: 'Очередь клипов', icon: Clapperboard },
  { label: 'YouTube', icon: CloudUpload },
  { label: 'Дневник', icon: WalletCards },
  { label: 'Настройки', icon: Settings }
]

export const Sidebar = () => (
  <aside className="glass-panel flex h-[calc(100vh-32px)] w-72 flex-col rounded-[28px] p-4">
    <div className="mb-8 flex items-center gap-3 px-2 pt-2">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 shadow-[0_0_42px_rgba(113,50,245,0.45)]">
        <Clapperboard size={22} />
      </div>
      <div>
        <div className="text-base font-semibold tracking-[-0.02em]">Trade Clipper</div>
        <div className="mono text-[11px] text-zinc-500">OBS • YouTube • Дневник</div>
      </div>
    </div>
    <nav className="space-y-1.5">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.label}
            className={clsx(
              'relative flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-3 text-sm transition',
              item.active ? 'text-white' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
            )}
          >
            {item.active && <motion.div layoutId="active-nav" className="absolute inset-0 rounded-2xl bg-violet-500/15 ring-1 ring-violet-400/25" />}
            <Icon className="relative" size={18} />
            <span className="relative font-medium">{item.label}</span>
          </button>
        )
      })}
    </nav>
    <div className="mt-auto rounded-3xl border border-violet-400/20 bg-violet-500/10 p-4">
      <div className="text-sm font-semibold">Авто-режим закрыт</div>
      <p className="mt-1 text-xs leading-5 text-zinc-400">Сначала ручная проверка и загрузка. Полная автоматизация включится после проверок пайплайна.</p>
    </div>
  </aside>
)
