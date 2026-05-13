import { Bell, CircleCheck, Search } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export type TopBarProps = {
  appVersion?: string
  onRunHealthCheck?: () => void
}

export const TopBar = ({ appVersion, onRunHealthCheck = () => undefined }: TopBarProps) => (
  <header className="flex items-center justify-between">
    <div>
      <div className="flex items-center gap-3">
        <h1 className="m-0 text-3xl font-semibold tracking-[-0.04em]">Пульт торговых клипов</h1>
        <Badge tone="warning">Локальный режим</Badge>
        {appVersion && <Badge tone="neutral">v{appVersion}</Badge>}
      </div>
      <p className="mt-2 text-sm text-zinc-400">Автоклипы по сделкам, очередь проверки, загрузка в YouTube и синхронизация с дневником.</p>
    </div>
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-500 lg:flex">
        <Search size={16} />
        <span>Поиск сделок, клипов, монет</span>
      </div>
      <Button variant="ghost" className="px-3"><Bell size={17} /></Button>
      <Button onClick={onRunHealthCheck}><CircleCheck size={17} className="mr-2" />Проверить систему</Button>
    </div>
  </header>
)
