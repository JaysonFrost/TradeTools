import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAppLogService } from '../../src/main/services/logging/appLogService'

describe('appLogService', () => {
  it('writes readable diagnostics that users can copy or send as a file', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-logs-'))
    const log = createAppLogService({
      appDataDir,
      now: () => Date.parse('2026-06-17T10:00:00.000Z')
    })

    await log.info('clip', 'Older event', { order: 1 })
    await log.error('clip', 'Clip render failed', new Error('ffmpeg exited with code 1'), {
      tradeId: 'trade-1',
      symbol: 'BTCUSDT',
      queuedCount: 3
    })

    const snapshot = await log.getSnapshot()

    expect(snapshot.path).toBe(join(appDataDir, 'logs', 'tradetools.log'))
    expect(snapshot.text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC[+-]\d{2}:\d{2} \[ERROR\] \[clip\] Clip render failed/)
    expect(snapshot.text).not.toContain('2026-06-17T10:00:00.000Z')
    expect(snapshot.text.indexOf('Clip render failed')).toBeLessThan(snapshot.text.indexOf('Older event'))
    expect(snapshot.text).toContain('ffmpeg exited with code 1')
    expect(snapshot.text).toContain('"tradeId":"trade-1"')
    expect(snapshot.text).toContain('"queuedCount":3')
    await expect(readFile(snapshot.path, 'utf8')).resolves.toMatch(/Older event[\s\S]+Clip render failed/)
  })
})
