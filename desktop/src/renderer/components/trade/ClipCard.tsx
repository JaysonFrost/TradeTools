import { ExternalLink, Play } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export const ClipCard = () => (
  <Card>
    <div className="flex gap-4">
      <div className="flex h-24 w-36 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-violet-600/40 to-black">
        <Play />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="m-0 truncate text-base font-semibold">2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4</h3>
          <Badge tone="warning">Review</Badge>
        </div>
        <p className="mono mt-2 text-xs text-zinc-500">1m 54s • 384 MB • YouTube not uploaded</p>
        <div className="mt-4 flex gap-2">
          <Button variant="ghost">Preview</Button>
          <Button><ExternalLink size={16} className="mr-2" />Upload</Button>
        </div>
      </div>
    </div>
  </Card>
)
