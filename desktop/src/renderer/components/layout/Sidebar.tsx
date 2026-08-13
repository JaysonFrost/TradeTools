import { Clapperboard, Heart, Network, Palette } from 'lucide-react'
import { clsx } from 'clsx'
import type { InterfaceTheme } from '../../../main/services/settings/settings'
import type { AppPage } from '../../lib/navigation'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'

export type SidebarProps = {
  activePage: AppPage
  onNavigate: (page: AppPage) => void
  interfaceTheme: InterfaceTheme
  onInterfaceThemeChange: (theme: InterfaceTheme) => Promise<void>
}

const items: Array<{ page: AppPage, label: string, description: string, code: string, icon: typeof Clapperboard }> = [
  { page: 'video', label: 'Видео', description: 'Запись, сделки, клипы', code: '01', icon: Clapperboard },
  { page: 'proxy', label: 'Прокси', description: 'Серверы, оплаты, цепочки', code: '02', icon: Network }
]

const supportItem = { page: 'support' as const, label: 'Сказать спасибо', description: 'USDT TRC20, TON, BSC', code: '03', icon: Heart }
const tradecoreUrl = 'https://t.me/tradekorr'

export const Sidebar = ({ activePage, onNavigate, interfaceTheme, onInterfaceThemeChange }: SidebarProps) => (
  <aside className="classic-rounded glass-panel relative z-10 flex shrink-0 flex-col border border-[#294155] bg-[#0d1b2a]/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.24)] lg:h-full lg:w-64 lg:p-4">
    <div className="mb-3 flex items-center gap-3 border-b border-[#294155] px-1 pb-3 lg:mb-6 lg:pb-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#56b5d5]/50 bg-[#0b1623] text-[#ff9f30]">
        <Clapperboard size={22} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold uppercase tracking-[0.08em] text-[#f0f0f0]">TradeTools</div>
          <button
            type="button"
            className="text-[9px] uppercase leading-none tracking-[0.12em] text-[#8b9bb4] transition-colors duration-150 hover:text-[#ff9f30] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9f30]"
            title="Открыть Telegram-канал tradecore"
            aria-label="Открыть Telegram-канал tradecore"
            onClick={() => void getTradeToolsApi().links.openExternal(tradecoreUrl)}
          >
            by tradecore
          </button>
        </div>
        <div data-classic-hide className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#8b9bb4]">REC / NET</div>
      </div>
    </div>
    <nav className="grid grid-cols-2 gap-2 lg:block lg:space-y-2" aria-label="Основные разделы">
      {items.map((item) => {
        const Icon = item.icon
        const active = item.page === activePage
        return (
          <button
            type="button"
            key={item.page}
            onClick={() => onNavigate(item.page)}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'relative flex w-full cursor-pointer items-center gap-3 border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9f30] lg:px-3.5 lg:py-3',
              active
                ? 'border-[#56b5d5]/40 bg-[#132739] text-[#f0f0f0]'
                : 'border-transparent text-[#8b9bb4] hover:border-[#294155] hover:bg-[#102131] hover:text-[#f0f0f0]'
            )}
          >
            {active ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-[#ff9f30]" /> : null}
            <Icon className={clsx('shrink-0', active && 'text-[#56b5d5]')} size={18} strokeWidth={1.7} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold uppercase tracking-[0.06em] sm:text-sm">{item.label}</span>
              <span className="mt-0.5 hidden text-[11px] text-[#8b9bb4] lg:block">{item.description}</span>
            </span>
            <span data-classic-hide aria-hidden="true" className="hidden text-[9px] tracking-[0.12em] text-[#5e748c] lg:block">{item.code}</span>
          </button>
        )
      })}
    </nav>
    <div className="mt-3 space-y-2 lg:mt-auto">
      <div className="classic-control border border-[#294155] bg-[#07111c] p-2.5" aria-label="Оформление приложения">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b9bb4]">
          <Palette size={14} className="text-[#56b5d5]" aria-hidden="true" />
          Оформление
        </div>
        <div className="classic-control grid grid-cols-2 gap-1 border border-[#294155] p-1">
          <button
            type="button"
            aria-pressed={interfaceTheme === 'classic'}
            onClick={() => void onInterfaceThemeChange('classic')}
            className={clsx(
              'classic-control min-h-8 border px-2 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9f30]',
              interfaceTheme === 'classic'
                ? 'border-[#56b5d5]/50 bg-[#132739] text-[#f0f0f0]'
                : 'border-transparent text-[#8b9bb4] hover:border-[#294155] hover:text-[#f0f0f0]'
            )}
          >
            Классика
          </button>
          <button
            type="button"
            aria-pressed={interfaceTheme === 'engineering-blueprint'}
            onClick={() => void onInterfaceThemeChange('engineering-blueprint')}
            className={clsx(
              'classic-control min-h-8 border px-2 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9f30]',
              interfaceTheme === 'engineering-blueprint'
                ? 'border-[#56b5d5]/50 bg-[#132739] text-[#f0f0f0]'
                : 'border-transparent text-[#8b9bb4] hover:border-[#294155] hover:text-[#f0f0f0]'
            )}
          >
            Чертёж
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onNavigate(supportItem.page)}
        aria-current={activePage === supportItem.page ? 'page' : undefined}
        className={clsx(
          'relative flex w-full cursor-pointer items-center gap-3 border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9f30] lg:px-3.5 lg:py-3',
          activePage === supportItem.page
            ? 'border-[#56b5d5]/40 bg-[#132739] text-[#f0f0f0]'
            : 'border-[#294155] bg-[#102131] text-[#c7d2df] hover:border-[#56b5d5]/40 hover:text-[#f0f0f0]'
        )}
      >
        {activePage === supportItem.page ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-[#ff9f30]" /> : null}
        <Heart className="shrink-0 text-[#00ff9d]" size={18} strokeWidth={1.7} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold uppercase tracking-[0.04em] sm:text-sm">{supportItem.label}</span>
          <span className="mt-0.5 hidden text-[11px] text-[#8b9bb4] lg:block">{supportItem.description}</span>
        </span>
        <span data-classic-hide aria-hidden="true" className="hidden text-[9px] tracking-[0.12em] text-[#5e748c] lg:block">{supportItem.code}</span>
      </button>
    </div>
  </aside>
)
