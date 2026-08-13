import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('visual system', () => {
  it('defines the supplied palette, drafting grid and sharp primitives', async () => {
    const [tokens, globals, entry, html, button, card, badge] = await Promise.all([
      readFile(resolve('src/renderer/styles/tokens.css'), 'utf8'),
      readFile(resolve('src/renderer/styles/globals.css'), 'utf8'),
      readFile(resolve('src/renderer/main.tsx'), 'utf8'),
      readFile(resolve('src/renderer/index.html'), 'utf8'),
      readFile(resolve('src/renderer/components/ui/Button.tsx'), 'utf8'),
      readFile(resolve('src/renderer/components/ui/Card.tsx'), 'utf8'),
      readFile(resolve('src/renderer/components/ui/Badge.tsx'), 'utf8')
    ])

    expect(tokens).toContain('--bg: #0b1623')
    expect(tokens).toContain('--action: #ff9f30')
    expect(tokens).toContain('--success: #00ff9d')
    expect(tokens).toContain('--grid-line: #1c2b3a')
    expect(tokens).toContain('--radius-card: 0px')
    expect(globals).toContain('linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)')
    expect(globals).toContain('font-family: "JetBrains Mono"')
    expect(entry).toContain("@fontsource/jetbrains-mono/400.css")
    expect(html).toContain("font-src 'self'")
    expect(button).not.toContain('rounded-')
    expect(card).not.toContain('rounded-')
    expect(badge).not.toContain('rounded-full')
  })

  it('keeps the shell static and carries the blueprint geometry into the widget', async () => {
    const [shell, widget] = await Promise.all([
      readFile(resolve('src/renderer/components/layout/AppShell.tsx'), 'utf8'),
      readFile(resolve('src/renderer/components/recording/RecordingWidget.tsx'), 'utf8')
    ])

    expect(shell).not.toContain("from 'framer-motion'")
    expect(shell).toContain('blueprint-frame')
    expect(widget).toContain('bg-[var(--bg)]')
    expect(widget).not.toContain('rounded-xl')
    expect(widget).not.toContain('rounded-md')
  })

  it('offers a persisted classic design switch directly above the support action', async () => {
    const [shell, sidebar, tokens, globals, settings] = await Promise.all([
      readFile(resolve('src/renderer/components/layout/AppShell.tsx'), 'utf8'),
      readFile(resolve('src/renderer/components/layout/Sidebar.tsx'), 'utf8'),
      readFile(resolve('src/renderer/styles/tokens.css'), 'utf8'),
      readFile(resolve('src/renderer/styles/globals.css'), 'utf8'),
      readFile(resolve('src/main/services/settings/settings.ts'), 'utf8')
    ])

    const supportControlsStart = sidebar.indexOf('<div className="mt-3 space-y-2 lg:mt-auto">')
    expect(sidebar.indexOf('Оформление', supportControlsStart)).toBeLessThan(sidebar.indexOf('onNavigate(supportItem.page)', supportControlsStart))
    expect(sidebar).toContain("onInterfaceThemeChange('classic')")
    expect(sidebar.indexOf('Классика', supportControlsStart)).toBeLessThan(sidebar.indexOf('Чертёж', supportControlsStart))
    expect(shell).toContain('getTradeToolsApi().settings.update({ system: { interfaceTheme: theme } })')
    expect(shell).toContain('rememberInterfaceTheme(theme)')
    expect(shell).toContain('applyInterfaceTheme(interfaceTheme)')
    expect(tokens).toContain("html[data-interface-theme='classic']")
    expect(tokens).toContain('--text-muted: #9298af')
    expect(globals).toContain("html[data-interface-theme='classic'] body")
    expect(globals).toContain("[class*='border-[#56b5d5']")
    expect(globals).toContain("[class*='bg-[#0d1d2b']")
    expect(globals).toContain("html[data-interface-theme='classic'] .mono")
    expect(globals).toContain('text-transform: none !important')
    expect(globals).toContain('[data-classic-hide]')
    expect(settings).toContain("interfaceTheme: 'classic'")
  })
})
