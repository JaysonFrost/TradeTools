import { describe, expect, it } from 'vitest'
import { getRecordingWidgetViewState } from '../../src/renderer/lib/recordingWidgetState'
import type { RecordingControlStatus } from '../../src/shared/recordingControl'

const idleStatus = (patch: Partial<RecordingControlStatus> = {}): RecordingControlStatus => ({
  enabled: true,
  operation: 'idle',
  active: true,
  protected: false,
  hotkey: 'CommandOrControl+Shift+F9',
  hotkeyAvailable: true,
  message: 'Встроенная запись активна',
  ...patch
})

describe('recording widget state', () => {
  it('shows the active recorder and offers a stop action', () => {
    expect(getRecordingWidgetViewState(idleStatus())).toMatchObject({
      tone: 'recording',
      title: 'Запись включена',
      actionLabel: 'Остановить',
      actionDisabled: false
    })
  })

  it('distinguishes waiting, stopped, protected, busy and error states', () => {
    expect(getRecordingWidgetViewState(idleStatus({ active: false }))).toMatchObject({ tone: 'waiting', title: 'Ожидаем источник' })
    expect(getRecordingWidgetViewState(idleStatus({ enabled: false, active: false }))).toMatchObject({ tone: 'stopped', title: 'Запись остановлена', actionLabel: 'Включить' })
    expect(getRecordingWidgetViewState(idleStatus({ protected: true, protectionReason: 'Идёт сделка' }))).toMatchObject({ tone: 'protected', title: 'Запись защищена', actionDisabled: false })
    expect(getRecordingWidgetViewState(idleStatus({ operation: 'stopping' }))).toMatchObject({ title: 'Останавливаем запись', actionDisabled: true })
    expect(getRecordingWidgetViewState(idleStatus({ lastError: 'Источник пропал' }))).toMatchObject({ tone: 'error', title: 'Нужна настройка' })
  })
})
