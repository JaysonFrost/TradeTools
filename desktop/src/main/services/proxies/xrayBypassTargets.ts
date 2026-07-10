import { lookup } from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'

export type XrayBypassTarget = {
  host: string
  address: string
}

export const localXrayConfigPath = (appDataDir: string): string => join(appDataDir, 'xray-runtime', 'trade-chain.json')

export const parseXrayBypassHosts = (config: unknown): string[] => {
  const outbounds = config && typeof config === 'object' ? (config as { outbounds?: unknown }).outbounds : undefined
  if (!Array.isArray(outbounds)) return []

  const hosts = outbounds.flatMap((outbound) => {
    if (!outbound || typeof outbound !== 'object') return []
    const value = outbound as { protocol?: unknown, settings?: { vnext?: unknown } }
    if (value.protocol !== 'vless' || !Array.isArray(value.settings?.vnext)) return []

    return value.settings.vnext.flatMap((node) => {
      if (!node || typeof node !== 'object') return []
      const address = (node as { address?: unknown }).address
      return typeof address === 'string' && address.trim() ? [address.trim()] : []
    })
  })

  return [...new Set(hosts)]
}

export const resolveXrayBypassTargets = async (
  configPath: string,
  resolveHost: (host: string) => Promise<string> = async (host) => (await lookup(host, { family: 4 })).address
): Promise<XrayBypassTarget[]> => {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const hosts = parseXrayBypassHosts(config)
  if (hosts.length === 0) throw new Error('В активной Xray-конфигурации не найден адрес VPS')

  const targets = await Promise.all(hosts.map(async (host) => ({
    host,
    address: isIP(host) === 4 ? host : await resolveHost(host)
  })))
  const seenAddresses = new Set<string>()
  return targets.filter((target) => {
    if (seenAddresses.has(target.address)) return false
    seenAddresses.add(target.address)
    return true
  })
}
