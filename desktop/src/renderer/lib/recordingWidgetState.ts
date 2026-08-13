import type { RecordingControlStatus } from '../../shared/recordingControl'

export type RecordingWidgetTone = 'recording' | 'waiting' | 'stopped' | 'protected' | 'busy' | 'error'

export type RecordingWidgetViewState = {
  tone: RecordingWidgetTone
  title: string
  detail: string
  actionLabel: string
  actionDisabled: boolean
}

export const getRecordingWidgetViewState = (status: RecordingControlStatus): RecordingWidgetViewState => {
  if (status.lastError) {
    return {
      tone: 'error',
      title: 'Нужна настройка',
      detail: status.lastError,
      actionLabel: status.enabled ? 'Остановить' : 'Включить',
      actionDisabled: false
    }
  }

  if (status.protected) {
    return {
      tone: 'protected',
      title: 'Запись защищена',
      detail: status.protectionReason || status.message,
      actionLabel: 'Остановить',
      actionDisabled: false
    }
  }

  if (status.operation !== 'idle') {
    const starting = status.operation === 'starting'
    return {
      tone: 'busy',
      title: starting ? 'Включаем запись' : 'Останавливаем запись',
      detail: status.message,
      actionLabel: starting ? 'Включаем...' : 'Останавливаем...',
      actionDisabled: true
    }
  }

  if (!status.enabled) {
    return {
      tone: 'stopped',
      title: 'Запись остановлена',
      detail: status.message,
      actionLabel: 'Включить',
      actionDisabled: false
    }
  }

  if (!status.active) {
    return {
      tone: 'waiting',
      title: 'Ожидаем источник',
      detail: status.message,
      actionLabel: 'Остановить',
      actionDisabled: false
    }
  }

  return {
    tone: 'recording',
    title: 'Запись включена',
    detail: status.message,
    actionLabel: 'Остановить',
    actionDisabled: false
  }
}
