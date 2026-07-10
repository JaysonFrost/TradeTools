import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseXrayBypassHosts, resolveXrayBypassTargets } from '../../src/main/services/proxies/xrayBypassTargets'

const directories: string[] = []

const createConfigPath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'tradetools-xray-targets-'))
  directories.push(directory)
  return join(directory, 'trade-chain.json')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('xrayBypassTargets', () => {
  it('extracts only VLESS endpoint hosts from a local Xray config', () => {
    expect(parseXrayBypassHosts({
      outbounds: [
        { protocol: 'freedom' },
        { protocol: 'vless', settings: { vnext: [{ address: '  entry.example  ' }, { address: '198.51.100.10' }, { address: 'entry.example' }] } }
      ]
    })).toEqual(['entry.example', '198.51.100.10'])
  })

  it('resolves and deduplicates IPv4 VLESS endpoints', async () => {
    const configPath = await createConfigPath()
    await writeFile(configPath, JSON.stringify({
      outbounds: [{ protocol: 'vless', settings: { vnext: [
        { address: '198.51.100.10' }, { address: 'entry.example' }, { address: '198.51.100.10' }
      ] } }]
    }), 'utf8')

    await expect(resolveXrayBypassTargets(configPath, async () => '203.0.113.20')).resolves.toEqual([
      { host: '198.51.100.10', address: '198.51.100.10' },
      { host: 'entry.example', address: '203.0.113.20' }
    ])
  })

  it('rejects a config without a VLESS VPS address', async () => {
    const configPath = await createConfigPath()
    await writeFile(configPath, JSON.stringify({ outbounds: [{ protocol: 'freedom' }] }), 'utf8')

    await expect(resolveXrayBypassTargets(configPath)).rejects.toThrow('В активной Xray-конфигурации не найден адрес VPS')
  })
})
