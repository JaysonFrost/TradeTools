import { Bell, CircleCheck, Search } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export const TopBar = () => (
  <header className="flex items-center justify-between">
    <div>
      <div className="flex items-center gap-3">
        <h1 className="m-0 text-3xl font-semibold tracking-[-0.04em]">Trading media cockpit</h1>
        <Badge tone="warning">Mock data</Badge>
      </div>
      <p className="mt-2 text-sm text-zinc-400">Automatic trade clips, review queue, YouTube upload, and Trader Make Money sync.</p>
    </div>
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-500 lg:flex">
        <Search size={16} />
        <span>Search trades, clips, symbols</span>
      </div>
      <Button variant="ghost" className="px-3"><Bell size={17} /></Button>
      <Button><CircleCheck size={17} className="mr-2" />Run health check</Button>
    </div>
  </header>
)
