import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  NullTarget,
  Output
} from 'mediabunny'

export type EncodedWindowFragment = {
  data: ArrayBuffer
  startedAtMs: number
  endedAtMs: number
}

const fragmentSeconds = 2

export const chooseWindowEncoderAcceleration = async (
  config: VideoEncoderConfig,
  preferGpu: boolean
): Promise<'prefer-hardware' | 'prefer-software'> => {
  if (preferGpu) {
    const hardware = await VideoEncoder.isConfigSupported({
      ...config, hardwareAcceleration: 'prefer-hardware'
    }).catch(() => ({ supported: false }))
    if (hardware.supported) return 'prefer-hardware'
  }
  return 'prefer-software'
}

const combine = (parts: Uint8Array[]): ArrayBuffer => {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes.buffer
}

/**
 * Encodes one continuous MediaStream. Only finalized, compressed key-frame groups leave
 * the encoder; the target discards its writes instead of retaining a whole recording.
 */
export const startCompressedWindowCapture = async (
  stream: MediaStream,
  frameRate: number,
  bitrate: number,
  preferGpu: boolean,
  onFragment: (fragment: EncodedWindowFragment) => void,
  onError: (error: unknown) => void
): Promise<{ stop: () => Promise<void>, startedAtMs: number, hardwareRequested: boolean }> => {
  const videoTrack = stream.getVideoTracks()[0]
  if (!videoTrack) throw new Error('Источник записи не вернул видеодорожку')
  const dimensions = videoTrack.getSettings()
  if (!dimensions.width || !dimensions.height || typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs недоступен для выбранного окна')
  }
  // H.264 requires even dimensions; terminal windows can have an odd-sized frame.
  const width = Math.max(2, dimensions.width - dimensions.width % 2)
  const height = Math.max(2, dimensions.height - dimensions.height % 2)

  const config = {
    codec: 'avc1.640033',
    width, height, framerate: frameRate, bitrate,
    latencyMode: 'realtime'
  } as const
  const hardwareAcceleration = await chooseWindowEncoderAcceleration(config, preferGpu)
  const hardwareRequested = hardwareAcceleration === 'prefer-hardware'
  const support = await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration })
  if (!support.supported) throw new Error('Кодировщик H.264 недоступен для разрешения выбранного окна')

  let ftyp: Uint8Array | undefined
  let moov: Uint8Array | undefined
  let moof: { bytes: Uint8Array, timestamp: number } | undefined
  let previous: { data: ArrayBuffer, timestamp: number } | undefined
  let stopped = false
  const startedAtMs = Date.now()
  const send = (item: { data: ArrayBuffer, timestamp: number }, endedAtMs: number) => {
    const fragmentStartedAtMs = startedAtMs + Math.round(item.timestamp * 1000)
    if (endedAtMs > fragmentStartedAtMs) {
      onFragment({ data: item.data, startedAtMs: fragmentStartedAtMs, endedAtMs })
    }
  }

  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: 'fragmented',
      minimumFragmentDuration: fragmentSeconds,
      onFtyp: (bytes) => { ftyp = bytes.slice() },
      onMoov: (bytes) => { moov = bytes.slice() },
      onMoof: (bytes, _position, timestamp) => {
        moof = { bytes: bytes.slice(), timestamp }
      },
      onMdat: (bytes) => {
        if (!ftyp || !moov || !moof) {
          onError(new Error('Неполный фрагмент MP4 от кодировщика'))
          return
        }
        const next = {
          data: combine([ftyp, moov, moof.bytes, bytes]),
          timestamp: moof.timestamp
        }
        if (previous) send(previous, startedAtMs + Math.round(next.timestamp * 1000))
        previous = next
        moof = undefined
      }
    }),
    target: new NullTarget()
  })

  const videoSource = new MediaStreamVideoTrackSource(videoTrack, {
    codec: 'avc',
    bitrate,
    keyFrameInterval: fragmentSeconds,
    hardwareAcceleration,
    latencyMode: 'realtime',
    sizeChangeBehavior: 'contain',
    ...(width !== dimensions.width || height !== dimensions.height ? { transform: { width, height, fit: 'contain' as const } } : {})
  }, { frameRate })
  output.addVideoTrack(videoSource)
  const audioTrack = stream.getAudioTracks()[0]
  let audioSource: MediaStreamAudioTrackSource | undefined
  if (audioTrack) {
    audioSource = new MediaStreamAudioTrackSource(audioTrack, { codec: 'aac', bitrate: 128_000 })
    output.addAudioTrack(audioSource)
    void audioSource.errorPromise.catch((error) => { if (!stopped) onError(error) })
  }
  void videoSource.errorPromise.catch((error) => { if (!stopped) onError(error) })
  try {
    await output.start()
  } catch (error) {
    stopped = true
    await output.cancel().catch(() => undefined)
    throw error
  }

  return {
    startedAtMs,
    hardwareRequested,
    stop: async () => {
      if (stopped) return
      stopped = true
      try {
        videoSource.close()
        audioSource?.close()
        await output.finalize()
        if (previous) {
          send(previous, Math.max(Date.now(), startedAtMs + Math.round(previous.timestamp * 1000) + 1))
          previous = undefined
        }
      } catch (error) {
        await output.cancel().catch(() => undefined)
        onError(error)
      } finally {
        previous = undefined
        moof = undefined
      }
    }
  }
}
