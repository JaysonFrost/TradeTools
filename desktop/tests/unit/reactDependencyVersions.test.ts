import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), 'utf8')) as T
const normalizeVersionSpec = (version: string): string => version.replace(/^[~^]/, '')

describe('React runtime dependencies', () => {
  test('keeps react and react-dom on the same version', () => {
    const packageJson = readJson<{
      dependencies: Record<string, string>
    }>('package.json')
    const lockfile = readJson<{
      packages: Record<string, { version?: string }>
    }>('package-lock.json')

    expect(normalizeVersionSpec(packageJson.dependencies.react)).toBe(normalizeVersionSpec(packageJson.dependencies['react-dom']))
    expect(lockfile.packages['node_modules/react']?.version).toBe(lockfile.packages['node_modules/react-dom']?.version)
  })
})
