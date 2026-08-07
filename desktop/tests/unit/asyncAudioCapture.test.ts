import { describe, expect, it, vi } from 'vitest'
import { startOptionalAudioCaptures } from '../../src/renderer/lib/asyncAudioCapture'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('startOptionalAudioCaptures', () => {
  it('starts system audio and microphone in parallel without waiting for either result', async () => {
    const system = deferred<string>()
    const microphone = deferred<string>()
    const events: string[] = []

    const result = startOptionalAudioCaptures({
      isActive: () => true,
      stopStream: (stream) => events.push(`stop:${stream}`),
      onError: (kind) => events.push(`error:${kind}`),
      tasks: [
        {
          kind: 'system',
          enabled: true,
          acquire: () => {
            events.push('acquire:system')
            return system.promise
          },
          connect: (stream) => events.push(`connect:${stream}`)
        },
        {
          kind: 'microphone',
          enabled: true,
          acquire: () => {
            events.push('acquire:microphone')
            return microphone.promise
          },
          connect: (stream) => events.push(`connect:${stream}`)
        }
      ]
    })

    expect(result).toBeUndefined()
    expect(events).toEqual(['acquire:system', 'acquire:microphone'])

    microphone.resolve('microphone-stream')
    await flushPromises()
    expect(events).toEqual(['acquire:system', 'acquire:microphone', 'connect:microphone-stream'])

    system.resolve('system-stream')
    await flushPromises()
    expect(events).toEqual([
      'acquire:system',
      'acquire:microphone',
      'connect:microphone-stream',
      'connect:system-stream'
    ])
  })

  it('keeps the other audio input alive when one acquisition fails', async () => {
    const onError = vi.fn()
    const connectMicrophone = vi.fn()

    startOptionalAudioCaptures({
      isActive: () => true,
      stopStream: vi.fn(),
      onError,
      tasks: [
        {
          kind: 'system',
          enabled: true,
          acquire: async () => { throw new Error('system unavailable') },
          connect: vi.fn()
        },
        {
          kind: 'microphone',
          enabled: true,
          acquire: async () => 'microphone-stream',
          connect: connectMicrophone
        }
      ]
    })

    await flushPromises()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('system', expect.objectContaining({ message: 'system unavailable' }))
    expect(connectMicrophone).toHaveBeenCalledWith('microphone-stream')
  })

  it('stops a stream that resolves after its recording session ended', async () => {
    const system = deferred<string>()
    const connect = vi.fn()
    const stopStream = vi.fn()
    const onError = vi.fn()
    let active = true

    startOptionalAudioCaptures({
      isActive: () => active,
      stopStream,
      onError,
      tasks: [{
        kind: 'system',
        enabled: true,
        acquire: () => system.promise,
        connect
      }]
    })

    active = false
    system.resolve('late-system-stream')
    await flushPromises()

    expect(connect).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(stopStream).toHaveBeenCalledWith('late-system-stream')
  })

  it('stops an acquired stream when connecting it fails without rejecting the caller', async () => {
    const stopStream = vi.fn()
    const onError = vi.fn()

    const result = startOptionalAudioCaptures({
      isActive: () => true,
      stopStream,
      onError,
      tasks: [{
        kind: 'microphone',
        enabled: true,
        acquire: async () => 'microphone-stream',
        connect: () => { throw new Error('mixer unavailable') }
      }]
    })

    expect(result).toBeUndefined()
    await flushPromises()
    expect(stopStream).toHaveBeenCalledWith('microphone-stream')
    expect(onError).toHaveBeenCalledWith('microphone', expect.objectContaining({ message: 'mixer unavailable' }))
  })
})
