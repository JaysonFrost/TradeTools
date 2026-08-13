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

  const isDownloading = status.status === 'downloading'
  const isError = status.status === 'error'
  const isReady = status.status === 'downloaded'
  const toneClass = isError
    ? 'border-[#ff9f30]/55 bg-[#ff9f30]/10'
    : isReady
      ? 'border-[#00ff9d]/45 bg-[#00ff9d]/[0.06]'
      : 'border-[#56b5d5]/45 bg-[#56b5d5]/[0.06]'
  const titleClass = isError ? 'text-[#ffc27a]' : isReady ? 'text-[#8fffd1]' : 'text-[#bcecff]'

  return (
    <div role="status" aria-live="polite" className={`mb-4 border border-l-2 px-4 py-3 ${toneClass}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${titleClass}`}>
            {isError ? <AlertTriangle size={16} strokeWidth={1.8} aria-hidden="true" /> : <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />}
            <span>{status.status === 'downloaded' ? 'Обновление готово' : status.status === 'available' ? 'Доступно обновление' : 'Обновления TradeTools'}</span>
            <span className="border-l border-current/25 pl-2 text-[9px] font-medium uppercase tracking-[0.14em] opacity-70">UPD / {status.status}</span>
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-[#b7c4d2]">{status.message}</p>
          {isDownloading && (
            <div
              className="mt-2 h-1.5 overflow-hidden bg-[#1c2b3a]"
              role="progressbar"
              aria-label="Загрузка обновления"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, status.percent ?? 0))}
            >
              <div className="h-full bg-[#00ff9d]" style={{ width: formatPercent(status.percent) }} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {status.status === 'available' && (
            <Button className="min-h-9 px-3 py-2 text-xs" onClick={onDownload}>
              <Download size={15} strokeWidth={1.8} className="mr-2" aria-hidden="true" />{status.manualInstall ? 'Открыть релиз' : 'Скачать'}
            </Button>
          )}
          {status.status === 'downloaded' && (
            <Button className="min-h-9 px-3 py-2 text-xs" onClick={onInstall}>
              <RotateCcw size={15} strokeWidth={1.8} className="mr-2" aria-hidden="true" />Перезапустить
            </Button>
          )}
          {isError && (
            <Button variant="ghost" className="min-h-9 px-3 py-2 text-xs" onClick={onCheck}>
              <RefreshCw size={15} strokeWidth={1.8} className="mr-2" aria-hidden="true" />Проверить ещё раз
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
