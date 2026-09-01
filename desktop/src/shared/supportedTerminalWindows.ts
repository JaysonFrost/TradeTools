export type SupportedTerminalId = 'vataga' | 'tigertrade' | 'lootx' | 'metascalp'

export const supportedTerminalLabels: Record<SupportedTerminalId, string> = {
  vataga: 'Vataga',
  tigertrade: 'TigerTrade',
  lootx: 'LootX',
  metascalp: 'MetaScalp'
}

const supportedTerminalWindowPatterns: ReadonlyArray<{
  id: SupportedTerminalId
  patterns: readonly RegExp[]
}> = [
  { id: 'vataga', patterns: [/\bvataga\b/i, /ватага/i] },
  { id: 'tigertrade', patterns: [/\btiger(?:\.com|\.trade|\s*trade)?\b/i, /тигр/i] },
  { id: 'lootx', patterns: [/\bloot\s*x\b/i] },
  { id: 'metascalp', patterns: [/\bmeta\s*scalp\b/i] }
]

const unsupportedWindowPatterns = [
  /\bTradeTools\b/i,
  /\bTradeClipper\b/i,
  /\bCodex\b/i,
  /\bDevTools\b/i,
  /\bElectron\b/i,
  /\bGoogle Chrome\b/i,
  /\bMicrosoft Edge\b/i,
  /\bMozilla Firefox\b/i,
  /\bBrave\b/i,
  /\bOpera\b/i
]

export const detectSupportedTerminalWindow = (name: string): SupportedTerminalId | undefined => {
  if (unsupportedWindowPatterns.some((pattern) => pattern.test(name))) return undefined
  return supportedTerminalWindowPatterns.find(({ patterns }) => patterns.some((pattern) => pattern.test(name)))?.id
}

export const isSupportedTerminalWindowName = (name: string): boolean => (
  detectSupportedTerminalWindow(name) !== undefined
)
