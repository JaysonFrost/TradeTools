import { ExternalLink, Play } from 'lucide-react'
import type { ClipQueueItem } from '../../../main/services/trades/tradeClipPipeline'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type ClipCardProps = {
  clip: ClipQueueItem
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}м ${rest}с` : `${rest}с`
}

export const ClipCard = ({ clip }: ClipCardProps) => (
  <Card>
    <div className="flex gap-4">
      <div className="flex h-24 w-36 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-violet-600/40 to-black">
        <Play />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="m-0 truncate text-base font-semibold">{clip.fileName}</h3>
          <Badge tone="warning">На проверке</Badge>
        </div>
        <p className="mono mt-2 truncate text-xs text-zinc-500">{formatDuration(clip.durationSeconds)} • {clip.videoPath} • YouTube еще не загружен</p>
        <div className="mt-4 flex gap-2">
          <Button variant="ghost">Предпросмотр</Button>
          <Button><ExternalLink size={16} className="mr-2" />Загрузить</Button>
        </div>
      </div>
    </div>
  </Card>
)
