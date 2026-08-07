import { describe, expect, it } from 'vitest'
import { preferTerminalSourcesForSymbol, recordingSourceMatchesTarget, terminalTitleMatchesTicker } from '../../src/main/services/recording/terminalWindowSelection'

describe('terminal window selection', () => {
  it('prefers the window whose title contains the exact normalized ticker', () => {
    const sources = [
      { id: 'btc', name: 'Tiger.com - BTC/USDT' },
      { id: 'eth', name: 'Tiger.com - ETHUSDT' }
    ]

    expect(preferTerminalSourcesForSymbol('ETHUSDT', sources)).toEqual([sources[1]])
  })

  it('keeps all candidates when no title contains the ticker', () => {
    const sources = [
      { id: 'first', name: 'Tiger.com' },
      { id: 'second', name: 'TigerTrade' }
    ]

    expect(preferTerminalSourcesForSymbol('BEATUSDT', sources)).toEqual(sources)
  })

  it('matches separated ticker titles without matching a suffix inside another alphanumeric ticker', () => {
    const beth = { id: 'beth', name: 'Tiger.com - BETHUSDT' }
    const eth = { id: 'eth', name: 'Tiger.com - ETH/USDT' }

    expect(terminalTitleMatchesTicker('Tiger.com - ETH-USDT chart', 'ETHUSDT')).toBe(true)
    expect(terminalTitleMatchesTicker(beth.name, 'ETHUSDT')).toBe(false)
    expect(preferTerminalSourcesForSymbol('ETHUSDT', [beth, eth])).toEqual([eth])
    expect(preferTerminalSourcesForSymbol('ETHUSDT', [beth])).toEqual([])
  })

  it('does not inherit readiness from another ticker window in the same terminal process', () => {
    const beatSource = {
      sourceId: 'window:beat',
      sourceName: 'Tiger.com - BEATUSDT',
      processId: 42
    }

    expect(recordingSourceMatchesTarget(beatSource, {
      id: 'window:hei',
      name: 'Tiger.com - HEIUSDT',
      processId: 42,
      symbol: 'HEIUSDT'
    })).toBe(false)
    expect(recordingSourceMatchesTarget(beatSource, {
      id: 'old-window:beat',
      name: 'Tiger.com',
      processId: 42,
      symbol: 'BEAT/USDT'
    })).toBe(true)
  })
})
