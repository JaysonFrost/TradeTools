export type OptionalAudioKind = 'system' | 'microphone'

export type OptionalAudioCaptureTask<TStream> = {
  kind: OptionalAudioKind
  enabled: boolean
  acquire: () => Promise<TStream>
  connect: (stream: TStream) => void
}

export type OptionalAudioCaptureOptions<TStream> = {
  tasks: Array<OptionalAudioCaptureTask<TStream>>
  isActive: () => boolean
  stopStream: (stream: TStream) => void
  onError: (kind: OptionalAudioKind, error: unknown) => void
}

export const startOptionalAudioCaptures = <TStream>({
  tasks,
  isActive,
  stopStream,
  onError
}: OptionalAudioCaptureOptions<TStream>): void => {
  tasks.forEach((task) => {
    if (!task.enabled) return

    let acquisition: Promise<TStream>
    try {
      acquisition = task.acquire()
    } catch (error) {
      if (isActive()) onError(task.kind, error)
      return
    }

    void acquisition.then((stream) => {
      if (!isActive()) {
        stopStream(stream)
        return
      }

      try {
        task.connect(stream)
      } catch (error) {
        stopStream(stream)
        if (isActive()) onError(task.kind, error)
      }
    }).catch((error: unknown) => {
      if (isActive()) onError(task.kind, error)
    })
  })
}
