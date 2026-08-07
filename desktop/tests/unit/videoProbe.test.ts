import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeVideoDetails } from '../../src/main/services/video/videoProbe'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

const createChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('videoProbe', () => {
  afterEach(() => {
    spawnMock.mockReset()
  })

  it('waits for ffprobe output streams to close before parsing JSON', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child)

    const probe = probeVideoDetails('C:/recordings/trade.mp4')
    const result = expect(probe).resolves.toMatchObject({
      durationSeconds: 4.5,
      averageFrameRate: 30,
      codecName: 'h264',
      width: 1920,
      height: 1080
    })
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())

    child.stdout.emit('data', '{"streams":[{"codec_name":"h264","width":1920,')
    child.emit('exit', 0)
    child.stdout.emit('data', '"height":1080,"duration":"4.5","avg_frame_rate":"30/1"}],"format":{"duration":"4.5"}}')
    child.emit('close', 0)

    await result
  })
})
