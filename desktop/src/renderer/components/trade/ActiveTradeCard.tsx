import { TrendingUp } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'

export const ActiveTradeCard = () => (
  <Card className="bg-gradient-to-br from-violet-500/15 to-white/[0.03]">
    <div className="flex items-start justify-between">
      <div>
        <Badge tone="purple">LIVE TRADE</Badge>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">BTCUSDT Long</h2>
        <p className="mono mt-2 text-sm text-zinc-400">BINANCE FUTURES • entry 03:49:21</p>
      </div>
      <div className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300"><TrendingUp /></div>
    </div>
    <div className="mt-8 grid grid-cols-3 gap-3">
      {[['Duration', '07:12'], ['Buffer', '30m'], ['PnL', '+$120.50']].map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-zinc-500">{label}</div>
          <div className="mono mt-1 text-lg text-zinc-100">{value}</div>
        </div>
      ))}
    </div>
  </Card>
)
