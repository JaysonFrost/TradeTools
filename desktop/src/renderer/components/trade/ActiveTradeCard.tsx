import { TrendingUp } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'

export const ActiveTradeCard = () => (
  <Card className="rounded-none border-cyan-400/25 bg-[#0b1623] shadow-none backdrop-blur-none">
    <div className="flex items-start justify-between">
      <div>
        <Badge tone="success">ТЕСТОВАЯ СДЕЛКА</Badge>
        <h2 className="mt-4 font-mono text-3xl font-semibold tracking-[-0.04em] text-[#f0f0f0]">BTCUSDT Long</h2>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.08em] text-[#8b9bb4]">BINANCE FUTURES // вход 03:49:21</p>
      </div>
      <div className="border border-emerald-400/30 bg-emerald-400/10 p-3 text-emerald-300"><TrendingUp /></div>
    </div>
    <div className="mt-8 grid grid-cols-3 gap-3">
      {[["Длительность", '07:12'], ['Буфер', '2 мин+'], ['PnL', '+$120.50']].map(([label, value]) => (
        <div key={label} className="border border-[#1c2b3a] bg-[#07111c] p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8b9bb4]">{label}</div>
          <div className={`mt-1 font-mono text-lg ${label === 'PnL' ? 'text-emerald-300' : 'text-[#f0f0f0]'}`}>{value}</div>
        </div>
      ))}
    </div>
  </Card>
)
