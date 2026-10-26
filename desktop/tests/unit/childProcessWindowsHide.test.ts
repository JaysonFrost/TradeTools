import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const listSourceFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return Promise.resolve(/\.tsx?$/.test(entry.name) ? [path] : [])
  }))
  return nested.flat()
}

const findUnhiddenChildProcessCalls = (source: string): string[] => {
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\(/.test(line) || /\.exec\(/.test(line)) return []
    const call = lines.slice(index, index + 20).join('\n')
    return call.includes('windowsHide: true') ? [] : [`${index + 1}: ${line.trim()}`]
  })
}

describe('child processes on Windows', () => {
  it('starts every child process without a console window', async () => {
    const files = await listSourceFiles(resolve('src/main'))
    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (!source.includes('node:child_process')) continue
      offenders.push(...findUnhiddenChildProcessCalls(source).map((call) => `${file}:${call}`))
    }
    expect(offenders).toEqual([])
  })
})
