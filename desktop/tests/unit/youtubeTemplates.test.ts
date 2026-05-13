import { describe, expect, it } from 'vitest'
import { renderYouTubeDescription, renderYouTubeTitle } from '../../src/main/services/youtube/youtubeTemplates'

const trade = {
  exchange: 'BINANCE',
  marketType: 'FUTURES',
  symbol: 'BTCUSDT',
  side: 'LONG',
  entryTime: '2026-05-13 03:49:21',
  exitTime: '2026-05-13 03:51:10',
  duration: '1m 49s',
  pnl: '+$120.50',
  journalUrl: 'https://journal.example/trades/42'
}

describe('youtubeTemplates', () => {
  it('renders a concise trade title', () => {
    expect(renderYouTubeTitle(trade)).toBe('BTCUSDT LONG trade — 2026-05-13 03:49:21 — BINANCE')
  })

  it('renders all important metadata in description', () => {
    const description = renderYouTubeDescription(trade)

    expect(description).toContain('Exchange: BINANCE')
    expect(description).toContain('Market: FUTURES')
    expect(description).toContain('Symbol: BTCUSDT')
    expect(description).toContain('Side: LONG')
    expect(description).toContain('Journal: https://journal.example/trades/42')
  })
})
