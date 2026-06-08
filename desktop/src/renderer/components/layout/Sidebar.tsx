import { motion } from 'framer-motion'
import { Clapperboard, Heart, Network } from 'lucide-react'
import { clsx } from 'clsx'
import type { AppPage } from '../../lib/navigation'

export type SidebarProps = {
  activePage: AppPage
  onNavigate: (page: AppPage) => void
}

const items: Array<{ page: AppPage, label: string, description: string, icon: typeof Clapperboard }> = [
  { page: 'video', label: 'Видео', description: 'OBS, сделки, клипы', icon: Clapperboard },
  { page: 'proxy', label: 'Прокси', description: 'Серверы, оплаты, цепочки', icon: Network }
]

const supportItem = { page: 'support' as const, label: 'Сказать спасибо', description: 'USDT TRC20, TON, BSC', icon: Heart }

export const Sidebar = ({ activePage, onNavigate }: SidebarProps) => (
  <aside className="glass-panel flex shrink-0 flex-col rounded-[24px] p-3 lg:h-full lg:w-72 lg:rounded-[28px] lg:p-4">
    <div className="mb-3 flex items-center gap-3 px-2 pt-1 lg:mb-8 lg:pt-2">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 shadow-[0_0_42px_rgba(113,50,245,0.45)]">
        <Clapperboard size={22} />
      </div>
      <div>
        <div className="text-base font-semibold tracking-[-0.02em]">TradeTools</div>
        <div className="mono text-[11px] text-zinc-500">Video • Proxy</div>
      </div>
    </div>
    <nav className="grid grid-cols-2 gap-2 lg:block lg:space-y-2">
      {items.map((item) => {
        const Icon = item.icon
        const active = item.page === activePage
        return (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className={clsx(
              'relative flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition lg:px-3.5 lg:py-3',
              active ? 'text-white' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
            )}
          >
            {active && <motion.div layoutId="active-nav" className="absolute inset-0 rounded-2xl bg-violet-500/15 ring-1 ring-violet-400/25" />}
            <Icon className="relative shrink-0" size={19} />
            <span className="relative min-w-0">
              <span className="block truncate text-xs font-semibold sm:text-sm">{item.label}</span>
              <span className="mt-0.5 hidden text-xs text-zinc-500 lg:block">{item.description}</span>
            </span>
          </button>
        )
      })}
    </nav>
    <div className="mt-3 lg:mt-auto">
      <button
        onClick={() => onNavigate(supportItem.page)}
        className={clsx(
          'relative flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition lg:px-3.5 lg:py-3',
          activePage === supportItem.page
            ? 'border-rose-400/30 bg-rose-500/15 text-white'
            : 'border-violet-400/20 bg-violet-500/10 text-zinc-300 hover:bg-violet-500/15 hover:text-zinc-100'
        )}
      >
        {activePage === supportItem.page && <motion.div layoutId="active-nav" className="absolute inset-0 rounded-2xl bg-rose-500/10 ring-1 ring-rose-300/20" />}
        <Heart className="relative shrink-0 text-rose-200" size={19} />
        <span className="relative min-w-0">
          <span className="block truncate text-sm font-semibold">{supportItem.label}</span>
          <span className="mt-0.5 hidden text-xs text-zinc-500 lg:block">{supportItem.description}</span>
        </span>
      </button>
    </div>
  </aside>
)
