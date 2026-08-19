import { Check, ExternalLink, GripHorizontal, LoaderCircle, Pin, PinOff, Play, Save, Square, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { recordingBufferSaveAccelerator, recordingToggleAccelerator, type RecordingControlStatus } from '../../../shared/recordingControl'
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
  bufferHotkey: recordingBufferSaveAccelerator,
  bufferHotkeyAvailable: true,
  message: 'Получаем состояние записи...'
}

const displayHotkey = (hotkey: string): string => hotkey
  .replace('CommandOrControl', 'Ctrl')
  .replace(/\+/g, ' ')

const dragRegionStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const compactButtonClass = 'flex h-7 w-7 shrink-0 items-center justify-center border bg-[var(--panel-strong)] disabled:cursor-not-allowed disabled:brightness-75'
const compactIconClass = 'text-[#f7fbff]'

export const RecordingWidget = () => {
  const [status, setStatus] = useState<RecordingControlStatus>(initialStatus)
  const [loading, setLoading] = useState(true)
  const [pinned, setPinned] = useState(true)
  const [savingBuffer, setSavingBuffer] = useState(false)
  const [bufferFeedback, setBufferFeedback] = useState('')
  const [bufferFailed, setBufferFailed] = useState(false)
  const [pinError, setPinError] = useState('')

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

    void api.app.getRecordingWidgetAlwaysOnTop()
      .then(setPinned)
      .catch((error) => setPinError(error instanceof Error ? error.message : 'Не удалось получить состояние закрепления'))

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

  const saveLatestBuffer = async () => {
    if (savingBuffer || !status.enabled) return
    setSavingBuffer(true)
    setBufferFailed(false)
    setBufferFeedback('Сохраняем последний буфер')
    try {
      const clips = await getTradeToolsApi().clips.createBuffer()
      setBufferFeedback(clips.length > 1 ? `Сохранено буферов: ${clips.length}` : 'Последний буфер сохранён')
    } catch (error) {
      setBufferFailed(true)
      setBufferFeedback(error instanceof Error ? error.message : 'Не удалось сохранить последний буфер')
    } finally {
      setSavingBuffer(false)
    }
  }

  const togglePinned = async () => {
    try {
      setPinned(await getTradeToolsApi().app.toggleRecordingWidgetAlwaysOnTop())
      setPinError('')
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'Не удалось изменить закрепление')
    }
  }

  const actionClass = status.enabled
    ? 'border-[var(--danger)] bg-[rgba(255,93,115,0.12)] text-[var(--danger)] hover:bg-[rgba(255,93,115,0.2)]'
    : 'border-[var(--action)] bg-[var(--action)] text-[var(--bg)] hover:bg-[var(--action-hover)]'
  const bufferLabel = bufferFeedback || 'Сохранить последний буфер'
  const bufferHotkeyLabel = status.bufferHotkeyAvailable ? displayHotkey(status.bufferHotkey) : 'хоткей занят'
  const pinLabel = pinError || (pinned ? 'Открепить от остальных окон' : 'Закрепить поверх окон')

  return (
    <main
      style={dragRegionStyle}
      className="blueprint-frame flex h-full w-full items-center gap-1 overflow-hidden bg-[var(--bg)] px-1.5 text-[var(--text)]"
    >
      <GripHorizontal size={14} className={`shrink-0 ${compactIconClass}`} aria-hidden="true" />

      <div className="flex min-w-0 flex-1 items-center gap-2 px-1" aria-live="polite" aria-atomic="true" title={view.detail}>
        <span className={`h-2.5 w-2.5 shrink-0 ${tone.dot}`} aria-hidden="true" />
        <span className={`truncate text-[10px] font-bold uppercase tracking-[0.06em] ${tone.eyebrow}`}>{view.title}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          style={noDragRegionStyle}
          className={`${compactButtonClass} ${actionClass}`}
          onClick={() => void toggleRecording()}
          disabled={busy}
          aria-label={`${view.actionLabel} фоновую запись`}
          title={`${view.actionLabel} фоновую запись (${status.hotkeyAvailable ? displayHotkey(status.hotkey) : 'хоткей занят'})`}
        >
          {status.enabled ? <Square size={13} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          style={noDragRegionStyle}
          className={`${compactButtonClass} ${bufferFailed ? 'border-[var(--danger)] text-[var(--danger)]' : bufferFeedback && !savingBuffer ? 'border-[var(--success)] text-[var(--success)]' : 'border-[var(--border)] text-[var(--line)] hover:border-[var(--line)] hover:text-[var(--text)]'}`}
          onClick={() => void saveLatestBuffer()}
          disabled={!status.enabled || savingBuffer}
          aria-label="Сохранить последний буфер"
          title={`${bufferLabel} (${bufferHotkeyLabel})`}
        >
          {savingBuffer
            ? <LoaderCircle size={15} className={`animate-spin ${compactIconClass}`} aria-hidden="true" />
            : bufferFailed
              ? <TriangleAlert size={15} className={compactIconClass} aria-hidden="true" />
              : bufferFeedback
                ? <Check size={15} className={compactIconClass} aria-hidden="true" />
                : <Save size={15} className={compactIconClass} aria-hidden="true" />}
        </button>
        <button
          type="button"
          style={noDragRegionStyle}
          className={`${compactButtonClass} ${pinError ? 'border-[var(--danger)] text-[var(--danger)]' : pinned ? 'border-[var(--action)] text-[var(--action)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--line)] hover:text-[var(--text)]'}`}
          onClick={() => void togglePinned()}
          aria-label={pinLabel}
          aria-pressed={pinned}
          title={pinLabel}
        >
          {pinned ? <Pin size={14} className={compactIconClass} aria-hidden="true" /> : <PinOff size={14} className={compactIconClass} aria-hidden="true" />}
        </button>
        <button
          type="button"
          style={noDragRegionStyle}
          className={`${compactButtonClass} border-[var(--border)] text-[#f7fbff] hover:border-[var(--line)] hover:text-[#ffffff]`}
          onClick={() => void getTradeToolsApi().app.showMainWindow()}
          aria-label="Открыть TradeTools"
          title="Открыть TradeTools"
        >
          <ExternalLink size={14} className={compactIconClass} aria-hidden="true" />
        </button>
        <button
          type="button"
          style={noDragRegionStyle}
          className={`${compactButtonClass} border-transparent text-[#f7fbff] hover:border-[var(--border-strong)] hover:text-[#ffffff]`}
          onClick={() => void getTradeToolsApi().app.closeRecordingWidget()}
          aria-label="Закрыть виджет записи"
          title="Закрыть виджет"
        >
          <X size={14} className={compactIconClass} aria-hidden="true" />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">{bufferFeedback}</span>
    </main>
  )
}
