export const recordingToggleAccelerator = 'CommandOrControl+Shift+F9'

export type RecordingControlOperation = 'idle' | 'starting' | 'stopping'

export type RecordingControlStatus = {
  enabled: boolean
  operation: RecordingControlOperation
  active: boolean
  protected: boolean
  protectionReason?: string
  hotkey: string
  hotkeyAvailable: boolean
  message: string
  lastError?: string
}
