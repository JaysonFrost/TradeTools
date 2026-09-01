import { describe, expect, it } from 'vitest'
import { normalizeTerminalSymbolToken } from '../../src/shared/terminalSymbol'

describe('terminal symbol normalization', () => {
  it('preserves Unicode letters while removing ticker separators', () => {
    expect(normalizeTerminalSymbolToken(' 龙虾/USDT ')).toBe('龙虾USDT')
    expect(normalizeTerminalSymbolToken('e\u0301/usdt')).toBe('ÉUSDT')
  })

  it('normalizes compatibility characters before matching symbols', () => {
    expect(normalizeTerminalSymbolToken('ＢＴＣ／ＵＳＤＴ')).toBe('BTCUSDT')
  })

  it('accepts scalar identifiers and ignores unsupported values', () => {
    expect(normalizeTerminalSymbolToken(123)).toBe('123')
    expect(normalizeTerminalSymbolToken({ symbol: '龙虾USDT' })).toBe('')
  })
})
