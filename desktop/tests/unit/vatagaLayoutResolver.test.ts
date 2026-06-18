import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { selectBestVatagaLayoutMatch, type VatagaLayoutRow } from '../../src/main/services/trades/vatagaLayoutResolver'

const row = (input: Partial<VatagaLayoutRow> & Pick<VatagaLayoutRow, 'workspaceId' | 'tabTitle' | 'x' | 'y'>): VatagaLayoutRow => ({
  workspaceId: input.workspaceId,
  workspaceTitle: input.workspaceTitle ?? '',
  tabTitle: input.tabTitle,
  isActive: input.isActive ?? false,
  x: input.x,
  y: input.y,
  width: input.width ?? 3440,
  height: input.height ?? 1400
})

describe('vatagaLayoutResolver', () => {
  it('prefers the exact symbol tab over a generic active DOM tab on another workspace', () => {
    const match = selectBestVatagaLayoutMatch('ESPORTSUSDT', [
      row({ workspaceId: 'top-screen', tabTitle: 'Стакан', isActive: true, x: 0, y: -1440 }),
      row({ workspaceId: 'primary-screen', tabTitle: 'ESPORTS', isActive: true, x: 0, y: 0 })
    ])

    expect(match).toMatchObject({
      workspaceId: 'primary-screen',
      bounds: { x: 0, y: 0, width: 3440, height: 1400 }
    })
  })

  it('keeps duplicate symbol tabs on different workspaces ambiguous', () => {
    const match = selectBestVatagaLayoutMatch('SIRENUSDT', [
      row({ workspaceId: 'screen-2', tabTitle: 'SIREN', x: -1707, y: -100 }),
      row({ workspaceId: 'screen-3', tabTitle: 'SIREN', x: 0, y: -1440 })
    ])

    expect(match).toBeUndefined()
  })

  it('prefers an active generic DOM tab over an inactive exact symbol tab on another workspace', () => {
    const match = selectBestVatagaLayoutMatch('HUSDT', [
      row({ workspaceId: 'top-screen', tabTitle: 'Стакан', isActive: true, x: 0, y: -1440 }),
      row({ workspaceId: 'primary-screen', tabTitle: 'H', isActive: false, x: 0, y: 0 })
    ])

    expect(match).toMatchObject({
      workspaceId: 'top-screen',
      bounds: { x: 0, y: -1440, width: 3440, height: 1400 }
    })
  })

  it('uses native e_sqlite3 through Windows PowerShell', async () => {
    const source = await readFile(resolve('src/main/services/trades/vatagaLayoutResolver.ts'), 'utf8')

    expect(source).toContain('DllImport("e_sqlite3"')
    expect(source).toContain("spawnSync('powershell.exe'")
    expect(source).not.toContain('Microsoft.Data.Sqlite.dll')
    expect(source).not.toContain('pwsh.exe')
  })
})
