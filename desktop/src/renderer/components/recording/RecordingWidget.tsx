import { ExternalLink, GripHorizontal, Play, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { recordingToggleAccelerator, type RecordingControlStatus } from '../../../shared/recordingControl'
import { applyInterfaceTheme, rememberInterfaceTheme } from '../../lib/interfaceTheme'
import { getRecordingWidgetViewState, type RecordingWidgetTone } from '../../lib/recordingWidgetState'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'

const toneClasses: Record<RecordingWidgetTone, { dot: string, eyebrow: string }> = {
  recording: { dot: 'bg-[var(--success)]', eyebrow: 'text-[var(--success)]' },
  waiting: { dot: 'bg-[var(--action)]', eyebrow: 'text-[var(--action)]' },
  stopped: { dot: 'border border-[var(--text-muted)] bg-transparent', eyebrow: 'text-[var(--text-muted)]' },
  protected: { dot: 'bg-[var(--line)]', eyebrow: 'text-[var(--line)]' },
  busy: { dot: 'bg-[var(--line)]', eyebrow: 'text-[var(--line)]' },
  error: { dot: 'bg-[var(--danger)]', eyebrow: 'text-[var(--danger)]' }
}

const initialStatus: RecordingControlStatus = {
  enabled: false,
  operation: 'idle',
  active: false,
  protected: false,
  hotkey: recordingToggleAccelerator,
  hotkeyAvailable: true,
  message: 'Получаем состояние записи...'
}

const displayHotkey = (hotkey: string): string => hotkey
  .replace('CommandOrControl', 'Ctrl')
  .replace(/\+/g, ' ')

const dragRegionStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export const RecordingWidget = () => {
  const [status, setStatus] = useState<RecordingControlStatus>(initialStatus)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const api = getTradeToolsApi()
    const unsubscribe = api.recording.onControlStatus((nextStatus) => {
      setStatus(nextStatus)
      setLoading(false)
    })

    void api.recording.getControlStatus()
      .then((nextStatus) => {
        setStatus(nextStatus)
        setLoading(false)
      })
      .catch((error) => {
        setStatus((current) => ({
          ...current,
          lastError: error instanceof Error ? error.message : 'Не удалось получить состояние записи'
        }))
        setLoading(false)
      })

    return unsubscribe
  }, [])

  useEffect(() => {
    const api = getTradeToolsApi()
    const unsubscribe = api.settings.onChanged((settings) => {
      const theme = settings.system.interfaceTheme
      applyInterfaceTheme(theme)
      rememberInterfaceTheme(theme)
    })

    void api.settings.get()
      .then((settings) => {
        const theme = settings.system.interfaceTheme
        applyInterfaceTheme(theme)
        rememberInterfaceTheme(theme)
      })
      .catch(() => undefined)

    return unsubscribe
  }, [])

  const view = getRecordingWidgetViewState(status)
  const tone = toneClasses[view.tone]
  const busy = loading || view.actionDisabled

  const toggleRecording = async () => {
    if (busy) return
    setLoading(true)
    try {
      setStatus(await getTradeToolsApi().recording.setEnabled(!status.enabled))
    } catch (error) {
      setStatus((current) => ({
        ...current,
        operation: 'idle',
        lastError: error instanceof Error ? error.message : 'Не удалось изменить состояние записи'
      }))
    } finally {
      setLoading(false)
    }
  }

  const actionClass = status.enabled
    ? 'border-[var(--danger)] bg-[rgba(255,93,115,0.12)] text-[var(--danger)] hover:bg-[rgba(255,93,115,0.2)]'
    : 'border-[var(--action)] bg-[var(--action)] text-[var(--bg)] hover:bg-[var(--action-hover)]'

  return (
    <main
      style={dragRegionStyle}
      className="blueprint-frame flex h-full w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]"
    >
      <div className="h-0.5 bg-[var(--action)]" />
      <header className="flex h-8 items-center gap-2 border-b border-[var(--border)] px-3">
        <GripHorizontal size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <span className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--line)]">TradeTools // REC</span>
        <span className="ml-auto mono text-[10px] text-[var(--text-muted)]">{status.hotkeyAvailable ? displayHotkey(status.hotkey) : 'Хоткей занят'}</span>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center border border-transparent text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          style={noDragRegionStyle}
          onClick={() => void getTradeToolsApi().app.closeRecordingWidget()}
          aria-label="Закрыть виджет записи"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
        <div className="min-w-0" aria-live="polite" aria-atomic="true">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 ${tone.dot}`} aria-hidden="true" />
            <span className={`truncate text-xs font-bold uppercase tracking-[0.08em] ${tone.eyebrow}`}>{view.title}</span>
          </div>
          <p className="mt-1 truncate pl-[18px] text-[10px] leading-4 text-[var(--text-muted)]" title={view.detail}>{view.detail}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            style={noDragRegionStyle}
            className={`inline-flex h-9 min-w-[104px] items-center justify-center border px-3 text-xs font-bold uppercase tracking-[0.04em] disabled:cursor-not-allowed disabled:opacity-50 ${actionClass}`}
            onClick={() => void toggleRecording()}
            disabled={busy}
            aria-label={`${view.actionLabel} фоновую запись`}
          >
            {status.enabled ? <Square size={14} className="mr-1.5" aria-hidden="true" /> : <Play size={14} className="mr-1.5" aria-hidden="true" />}
            {loading ? 'Подождите...' : view.actionLabel}
          </button>
          <button
            type="button"
            style={noDragRegionStyle}
            className="flex h-9 w-9 items-center justify-center border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--text-muted)] hover:border-[var(--line)] hover:text-[var(--text)]"
            onClick={() => void getTradeToolsApi().app.showMainWindow()}
            aria-label="Открыть TradeTools"
            title="Открыть TradeTools"
          >
            <ExternalLink size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  )
}
