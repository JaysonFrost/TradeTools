import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('main app lifecycle', () => {
  it('starts OBS Replay Buffer proactively when Binance watcher starts', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')
    const startWatcherIndex = source.indexOf('const startBinanceFuturesPolling')
    const ensureObsIndex = source.indexOf('ensureObsReplayBufferActive(true)', startWatcherIndex)

    expect(source).toContain('const ensureObsReplayBufferActive')
    expect(ensureObsIndex).toBeGreaterThan(startWatcherIndex)
  })
})
