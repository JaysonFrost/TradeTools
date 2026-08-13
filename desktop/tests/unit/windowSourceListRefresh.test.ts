import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WindowCaptureSource } from '../../src/main/services/recording/windowRecorderService'
import { refreshWindowSourceList } from '../../src/renderer/lib/windowSourceListRefresh'
import { findPreferredTerminalSource } from '../../src/renderer/lib/windowCaptureSources'

describe('window source list refresh', () => {
  it.each([
    { id: 'window:obsidian', name: 'Obsidian - Торговый дневник' },
    { id: 'window:vataga', name: 'Vataga.terminal' }
  ])('preserves a hydrated HAPP selection when an async mount refresh prefers $name', async (preferred) => {
    let resolveSources: (sources: WindowCaptureSource[]) => void = () => undefined
    const pendingSources = new Promise<WindowCaptureSource[]>((resolve) => {
      resolveSources = resolve
    })
    let selectedSource = {
      id: '',
      name: ''
    }
    let visibleSources: WindowCaptureSource[] = []
    const refresh = refreshWindowSourceList(
      () => pendingSources,
      (sources) => {
        visibleSources = sources
      }
    )

    selectedSource = {
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)'
    }
    const sources: WindowCaptureSource[] = [
      {
        id: preferred.id,
        name: preferred.name,
        displayId: '',
        type: 'window'
      },
      {
        id: selectedSource.id,
        name: selectedSource.name,
        displayId: '',
        type: 'window'
      }
    ]
    expect(findPreferredTerminalSource(sources)?.id).toBe(preferred.id)

    resolveSources(sources)
    await refresh

    expect(selectedSource).toEqual({
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)'
    })
    expect(visibleSources).toEqual(sources)
  })

  it('keeps the panel refresh path list-only so an async response cannot autosave a source', async () => {
    const source = await readFile(resolve('src/renderer/components/settings/RecordingSettingsPanel.tsx'), 'utf8')
    const refreshStart = source.indexOf('const refreshWindowSources = async')
    const refreshEnd = source.indexOf('\n  useEffect(() => {', refreshStart)
    const refreshSource = source.slice(refreshStart, refreshEnd)

    expect(refreshSource).toContain('refreshWindowSourceList')
    expect(refreshSource).not.toContain('findPreferredTerminalSource')
    expect(refreshSource).not.toContain('setWindowSourceId')
    expect(refreshSource).not.toContain('setWindowSourceName')
    expect(refreshSource).not.toContain('setCaptureTargets')
  })

  it('keeps the setup wizard refresh list-only so a stale response cannot replace hydrated HAPP', async () => {
    const source = await readFile(resolve('src/renderer/components/setup/SetupWizard.tsx'), 'utf8')
    const refreshStart = source.indexOf('const refreshWindowSources = async')
    const refreshEnd = source.indexOf('\n  useEffect(() => {', refreshStart)
    const refreshSource = source.slice(refreshStart, refreshEnd)

    expect(refreshSource).toContain('refreshWindowSourceList')
    expect(refreshSource).not.toContain('findPreferredTerminalSource')
    expect(refreshSource).not.toContain('setWindowSourceId')
    expect(refreshSource).not.toContain('setWindowSourceName')
    expect(refreshSource).not.toContain('setCaptureTargets')
  })
})
