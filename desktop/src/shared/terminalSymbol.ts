const terminalSymbolSeparatorPattern = /[^\p{L}\p{M}\p{N}]+/gu

const toTerminalSymbolText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return ''
}

export const normalizeTerminalSymbolToken = (value: unknown): string => (
  toTerminalSymbolText(value)
    .trim()
    .normalize('NFKC')
    .toUpperCase()
    .normalize('NFKC')
    .replace(terminalSymbolSeparatorPattern, '')
)
