import { describe, expect, it } from 'vitest'
import {
  preferTerminalSourcesForSymbol,
  recordingSourceMatchesTarget,
  recordingSourcesMatchingTarget,
  selectManualTerminalWindowSource,
  selectTerminalWindowSource,
  terminalTitleMatchesTicker
} from '../../src/main/services/recording/terminalWindowSelection'

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

  it('matches a Chinese ticker without confusing it with a longer Unicode symbol', () => {
    const lobster = { id: 'lobster', name: 'LootX - 龙虾/USDT chart' }
    const dragonFish = { id: 'dragon-fish', name: 'LootX - 龙鱼/USDT chart' }

    expect(terminalTitleMatchesTicker(lobster.name, '龙虾USDT')).toBe(true)
    expect(terminalTitleMatchesTicker('LootX - 小龙虾USDT chart', '龙虾USDT')).toBe(false)
    expect(terminalTitleMatchesTicker('LootX - 龙虾USDTA chart', '龙虾USDT')).toBe(false)
    expect(preferTerminalSourcesForSymbol('龙虾USDT', [dragonFish, lobster])).toEqual([lobster])
  })

  it('matches supplementary-plane and full-width terminal symbols', () => {
    expect(terminalTitleMatchesTicker('LootX - 𠮷/USDT chart', '𠮷USDT')).toBe(true)
    expect(terminalTitleMatchesTicker('ＬｏｏｔＸ - ＢＴＣ／ＵＳＤＴ', 'BTCUSDT')).toBe(true)
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
    }, [beatSource])).toBe(false)
    expect(recordingSourceMatchesTarget(beatSource, {
      id: 'old-window:beat',
      name: 'Tiger.com',
      processId: 42,
      symbol: 'BEAT/USDT'
    }, [beatSource])).toBe(true)
  })

  it('lets an exact source id dominate duplicate terminal names', () => {
    const first = { sourceId: 'window:lootx-one', sourceName: 'LootX', processId: 42 }
    const second = { sourceId: 'window:lootx-two', sourceName: 'LootX', processId: 42 }
    const sources = [first, second]
    const target = { id: first.sourceId, name: 'LootX', processId: 42 }

    expect(recordingSourcesMatchingTarget(sources, target)).toEqual([first])
    expect(recordingSourceMatchesTarget(first, target, sources)).toBe(true)
    expect(recordingSourceMatchesTarget(second, target, sources)).toBe(false)
  })

  it('falls back to a terminal name only when it identifies one source id', () => {
    const firstSegment = { sourceId: 'window:lootx-new', sourceName: 'LootX' }
    const secondSegment = { sourceId: 'window:lootx-new', sourceName: 'LootX' }
    const otherWindow = { sourceId: 'window:lootx-other', sourceName: 'LootX' }
    const staleTarget = { id: 'window:lootx-old', name: 'LootX' }

    expect(recordingSourcesMatchingTarget([firstSegment, secondSegment], staleTarget)).toEqual([
      firstSegment,
      secondSegment
    ])
    expect(recordingSourcesMatchingTarget([firstSegment, secondSegment, otherWindow], staleTarget)).toEqual([])
  })

  it('uses process and ticker to safely disambiguate a replaced source id', () => {
    const expected = { sourceId: 'window:new-eth', sourceName: 'Tiger.com - ETHUSDT', processId: 42 }
    const sameNameOtherProcess = { sourceId: 'window:other-process', sourceName: 'Tiger.com - ETHUSDT', processId: 84 }
    const sameProcessOtherTicker = { sourceId: 'window:new-btc', sourceName: 'Tiger.com - BTCUSDT', processId: 42 }

    expect(recordingSourcesMatchingTarget([
      expected,
      sameNameOtherProcess,
      sameProcessOtherTicker
    ], {
      id: 'window:old-eth',
      name: 'Tiger.com - ETHUSDT',
      processId: 42,
      symbol: 'ETHUSDT'
    })).toEqual([expected])
  })

  it('selects one duplicate same-named terminal after process, ticker, and cursor checks', () => {
    const first = {
      id: 'window:lootx-one',
      name: 'LootX',
      bounds: { x: 0, y: 0, width: 100, height: 100 }
    }
    const second = {
      id: 'window:lootx-two',
      name: 'LootX',
      bounds: { x: 100, y: 0, width: 100, height: 100 }
    }

    expect(selectTerminalWindowSource({ symbol: 'ETHUSDT' }, [first, second], { x: 150, y: 50 })).toMatchObject({
      source: second,
      reason: 'cursor'
    })
    expect(selectTerminalWindowSource({ symbol: 'ETHUSDT' }, [first, second])).toMatchObject({
      source: first,
      reason: 'first'
    })
  })

  it('selects the active live terminal for manual recording instead of the first stale candidate', () => {
    const staleTiger = { id: 'window:tiger-old', name: 'TigerTrade' }
    const liveLootx = { id: 'window:lootx', name: 'LootX' }

    expect(selectManualTerminalWindowSource(
      [staleTiger, liveLootx],
      new Set([liveLootx.id]),
      { id: staleTiger.id, name: staleTiger.name }
    )).toBe(liveLootx)
  })

  it('prefers the cursor window over the current live settings selection', () => {
    const vataga = {
      id: 'window:vataga',
      name: 'Vataga.terminal',
      bounds: { x: 0, y: 0, width: 100, height: 100 }
    }
    const lootx = {
      id: 'window:lootx',
      name: 'LootX',
      bounds: { x: 100, y: 0, width: 100, height: 100 }
    }
    const activeIds = new Set([vataga.id, lootx.id])

    expect(selectManualTerminalWindowSource(
      [vataga, lootx],
      activeIds,
      { id: vataga.id, name: vataga.name },
      { x: 150, y: 50 }
    )).toBe(lootx)
  })

  it('prefers the current live settings selection when no candidate contains the cursor', () => {
    const vataga = { id: 'window:vataga', name: 'Vataga.terminal' }
    const lootx = { id: 'window:lootx', name: 'LootX' }
    const activeIds = new Set([vataga.id, lootx.id])

    expect(selectManualTerminalWindowSource(
      [vataga, lootx],
      activeIds,
      { id: lootx.id, name: lootx.name }
    )).toBe(lootx)
  })

  it('uses a stable fallback independent of desktop capture source order', () => {
    const vataga = { id: 'window:vataga', name: 'Vataga.terminal' }
    const lootx = { id: 'window:lootx', name: 'LootX' }
    const activeIds = new Set([vataga.id, lootx.id])

    expect(selectManualTerminalWindowSource([vataga, lootx], activeIds)).toBe(lootx)
    expect(selectManualTerminalWindowSource([lootx, vataga], activeIds)).toBe(lootx)
  })
})
