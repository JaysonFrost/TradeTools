import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildClipFileNames, buildClipOutputPaths } from '../../src/main/services/video/clipPaths'

const trade = {
  exchange: 'BINANCE',
  marketType: 'FUTURES',
  symbol: 'BTCUSDT',
  side: 'LONG',
  entryTimeMs: new Date(2026, 4, 22, 14, 32, 11).getTime()
}

describe('clipPaths', () => {
  it('builds readable clip titles and filenames for Binance symbols', () => {
    expect(buildClipFileNames(trade)).toEqual({
      title: 'BTCUSDT Binance 22.05.26 14:32:11',
      videoFileName: 'BTCUSDT Binance 22.05.26 14-32-11.mp4',
      metadataFileName: 'BTCUSDT Binance 22.05.26 14-32-11.json'
    })
  })

  it('places clips under dated output folder', () => {
    expect(buildClipOutputPaths('/Users/igor/TradeClips', trade)).toEqual({
      dayFolder: join('/Users/igor/TradeClips', '2026-05-22'),
      videoPath: join('/Users/igor/TradeClips', '2026-05-22', 'BTCUSDT Binance 22.05.26 14-32-11.mp4'),
      metadataPath: join('/Users/igor/TradeClips', '2026-05-22', 'BTCUSDT Binance 22.05.26 14-32-11.json')
    })
  })
})
