import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('windowRecorderService', () => {
  it('reports buffered and required seconds when replay export is requested too early', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('const formatRoundedSeconds')
    expect(source).toContain('const bufferedSeconds')
    expect(source).toContain('const requiredSeconds')
    expect(source).toContain('Накоплено ${formatRoundedSeconds(bufferedSeconds)}')
    expect(source).toContain('нужно примерно ${formatRoundedSeconds(requiredSeconds)}')
    expect(source).toContain('Осталось примерно ${formatRoundedSeconds(remainingSeconds)}')
  })
})
