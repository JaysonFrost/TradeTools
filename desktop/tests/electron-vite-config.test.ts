import type { OutputOptions } from 'rollup'
import { resolveConfig } from 'electron-vite'
import { resolveConfig as resolveViteConfig } from 'vite'
import { describe, expect, test } from 'vitest'

const getSingleOutputOptions = async (): Promise<OutputOptions> => {
  const resolved = await resolveConfig({ configFile: 'electron.vite.config.ts' }, 'build')
  const preloadConfig = resolved.config?.preload

  if (!preloadConfig) {
    throw new Error('Expected electron-vite preload config')
  }

  const viteConfig = await resolveViteConfig(preloadConfig, 'build', 'production')
  const output = viteConfig.build.rollupOptions.output

  if (!output || Array.isArray(output)) {
    throw new Error('Expected preload build to use one Rollup output')
  }

  return output as OutputOptions
}

describe('electron-vite config', () => {
  test('builds the preload bundle as CommonJS for Electron sandbox preload', async () => {
    await expect(getSingleOutputOptions()).resolves.toMatchObject({
      format: 'cjs'
    })
  })
})
