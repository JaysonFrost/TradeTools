import { AlertTriangle, Download, RefreshCw, RotateCcw } from 'lucide-react'
import type { AppUpdateStatus } from '../../../main/services/updates/appUpdateService'
import { Button } from '../ui/Button'

export type UpdateBannerProps = {
  status?: AppUpdateStatus
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
}

const visibleStatuses = new Set<AppUpdateStatus['status']>(['checking', 'available', 'downloading', 'downloaded', 'installing', 'error'])

const formatPercent = (percent?: number): string => `${Math.max(0, Math.min(100, percent ?? 0))}%`

export const UpdateBanner = ({ status, onCheck, onDownload, onInstall }: UpdateBannerProps) => {
  if (!status || !visibleStatuses.has(status.status)) return null

  const isChecking = status.status === 'checking'
  const isDownloading = status.status === 'downloading'
  const isInstalling = status.status === 'installing'
  const isBusy = isChecking || isDownloading || isInstalling
  const isError = status.status === 'error'

  return (
    <div className={`mb-4 rounded-2xl border px-4 py-3 ${isError ? 'border-amber-300/20 bg-amber-400/10' : 'border-violet-300/20 bg-violet-500/10'}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className={`flex items-center gap-2 text-sm font-semibold ${isError ? 'text-amber-200' : 'text-violet-100'}`}>
            {isError ? <AlertTriangle size={16} /> : <RefreshCw size={16} className={isBusy ? 'animate-spin' : ''} />}
            <span>{status.status === 'downloaded' ? 'Обновление готово' : status.status === 'available' ? 'Доступно обновление' : 'Обновления TradeTools'}</span>
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-zinc-300">{status.message}</p>
          {isDownloading && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: formatPercent(status.percent) }} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {status.status === 'available' && (
            <Button className="min-h-9 px-3 py-2 text-xs" onClick={onDownload}>
              <Download size={15} className="mr-2" />Скачать
            </Button>
          )}
          {status.status === 'downloaded' && (
            <Button className="min-h-9 px-3 py-2 text-xs" onClick={onInstall}>
              <RotateCcw size={15} className="mr-2" />Перезапустить
            </Button>
          )}
          {isError && (
            <Button variant="ghost" className="min-h-9 px-3 py-2 text-xs" onClick={onCheck}>
              <RefreshCw size={15} className="mr-2" />Проверить ещё раз
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
