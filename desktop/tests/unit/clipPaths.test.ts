import { describe, expect, it } from 'vitest'
import { buildClipFileNames, buildClipOutputPaths } from '../../src/main/services/video/clipPaths'

const trade = {
  exchange: 'BINANCE',
  marketType: 'FUTURES',
  symbol: 'BTCUSDT',
  side: 'LONG',
  entryTimeMs: Date.parse('2026-05-13T03:49:21.000Z')
}

describe('clipPaths', () => {
  it('builds deterministic sanitized clip and metadata filenames', () => {
    expect(buildClipFileNames(trade)).toEqual({
      videoFileName: '2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4',
      metadataFileName: '2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.json'
    })
  })

  it('places clips under dated output folder', () => {
    expect(buildClipOutputPaths('/Users/igor/TradeClips', trade)).toEqual({
      dayFolder: '/Users/igor/TradeClips/clips/2026-05-13',
      videoPath: '/Users/igor/TradeClips/clips/2026-05-13/2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4',
      metadataPath: '/Users/igor/TradeClips/clips/2026-05-13/2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.json'
    })
  })
})
