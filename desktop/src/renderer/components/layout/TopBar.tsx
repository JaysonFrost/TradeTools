import { Bell, CircleCheck, Rocket, Search } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export type TopBarProps = {
  appVersion?: string
  onRunHealthCheck?: () => void
  onOpenSetupWizard?: () => void
}

export const TopBar = ({ appVersion, onRunHealthCheck = () => undefined, onOpenSetupWizard = () => undefined }: TopBarProps) => (
  <header className="flex items-start justify-between gap-6">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 whitespace-nowrap text-3xl font-semibold tracking-[-0.04em]">TradeCut</h1>
        <Badge tone="warning">Локальный режим</Badge>
        {appVersion && <Badge tone="neutral">v{appVersion}</Badge>}
      </div>
      <p className="mt-2 text-sm text-zinc-400">Автоклипы по сделкам, локальная очередь проверки и синхронизация с дневником.</p>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
      <div className="hidden items-center gap-2 whitespace-nowrap rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-500 2xl:flex">
        <Search size={16} />
        <span>Поиск сделок, клипов, монет</span>
      </div>
      <Button variant="ghost" className="px-3"><Bell size={17} /></Button>
      <Button variant="ghost" onClick={onOpenSetupWizard}><Rocket size={17} className="mr-2" />Пошаговая настройка</Button>
      <Button onClick={onRunHealthCheck}><CircleCheck size={17} className="mr-2" />Проверить систему</Button>
    </div>
  </header>
)
