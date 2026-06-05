import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import { getTradeCutApi } from '../../lib/tradeCutApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type BinanceFuturesSettingsPanelProps = {
  settings?: AppSettings
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'

export const BinanceFuturesSettingsPanel = ({ settings, onSaved }: BinanceFuturesSettingsPanelProps) => {
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [testnet, setTestnet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!settings) return
    setTestnet(settings.exchange.binanceFutures.testnet)
  }, [settings])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const api = getTradeCutApi()
      const updated = await api.settings.update({
        exchange: {
          binanceFutures: {
            enabled: settings?.exchange.binanceFutures.enabled ?? false,
            testnet
          }
        },
        binanceFuturesApiKey: apiKey.trim() || undefined,
        binanceFuturesApiSecret: apiSecret.trim() || undefined
      })
      onSaved(updated)
      setApiKey('')
      setApiSecret('')
      setMessage('Binance Futures настройки сохранены')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить Binance Futures')
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setMessage('')
    try {
      const api = getTradeCutApi()
      const status = await api.binance.testFuturesConnection()
      setMessage(status.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось проверить Binance Futures')
    } finally {
      setTesting(false)
    }
  }

  const configured = settings?.exchange.binanceFutures.apiKeyConfigured && settings.exchange.binanceFutures.apiSecretConfigured

  return (
    <Card className="border-violet-400/20 bg-violet-500/10" id="binance-settings">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Binance USDT-M Futures</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {configured ? 'Ключи сохранены. После перезапуска приложение будет отслеживать futures-позиции и создавать клип при закрытии.' : 'Вставьте Binance Futures API Key и Secret, чтобы клипы создавались по реальным сделкам.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={testConnection} disabled={testing}>{testing ? 'Проверяем...' : 'Проверить Binance'}</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить ключи'}</Button>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-medium text-zinc-500">
          API Key
          <input className={inputClass} value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder={settings?.exchange.binanceFutures.apiKeyConfigured ? 'Сохранён' : 'Не задан'} />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          API Secret
          <input className={inputClass} value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} type="password" placeholder={settings?.exchange.binanceFutures.apiSecretConfigured ? 'Сохранён' : 'Не задан'} />
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm text-zinc-300">
          <input className="h-4 w-4 accent-violet-500" checked={testnet} onChange={(event) => setTestnet(event.target.checked)} type="checkbox" />
          Testnet
        </label>
      </div>
      {message && <p className="mt-4 text-sm text-violet-100">{message}</p>}
    </Card>
  )
}
