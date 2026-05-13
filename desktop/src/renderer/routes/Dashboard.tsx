import { useEffect, useMemo, useState } from 'react'
import type { ObsStatus } from '../../main/services/obs/obsService'
import type { AppSettings } from '../../main/services/settings/settings'
import { ActiveTradeCard } from '../components/trade/ActiveTradeCard'
import { ClipCard } from '../components/trade/ClipCard'
import { IntegrationStatusCard } from '../components/integrations/IntegrationStatusCard'

type ObsUiState = {
  status: string
  message: string
  connected: boolean
  replayBufferActive: boolean
}

const pipelineSteps = ['Закрытие сделки найдено', 'OBS Replay Buffer сохранён', 'ffmpeg обрезка спланирована', 'Ожидает ручного подтверждения YouTube']

export const Dashboard = () => {
  const [obs, setObs] = useState<ObsUiState>({
    status: 'Проверка',
    message: 'Запрашиваем статус OBS через локальный IPC...',
    connected: false,
    replayBufferActive: false
  })
  const [clipDir, setClipDir] = useState('Загрузка настроек...')

  useEffect(() => {
    let mounted = true

    void window.tradeClipper.obs.getStatus().then((status: ObsStatus) => {
      if (!mounted) return
      setObs({
        status: status.status === 'setup-needed' ? 'Нужно настроить' : status.status === 'connected' ? 'Подключено' : 'Тест',
        message: status.message,
        connected: status.connected,
        replayBufferActive: status.replayBufferActive
      })
    })

    void window.tradeClipper.settings.get().then((settings: AppSettings) => {
      if (!mounted) return
      setClipDir(settings.clip.outputDir)
    })

    return () => {
      mounted = false
    }
  }, [])

  const integrations = useMemo(() => [
    {
      name: 'OBS Replay Buffer',
      description: obs.message,
      status: obs.status,
      tone: obs.connected ? 'success' as const : 'warning' as const
    },
    {
      name: 'YouTube загрузка',
      description: 'Google OAuth ещё не подключён. Сначала клипы остаются в очереди ручной проверки.',
      status: 'Нужно настроить',
      tone: 'warning' as const
    },
    {
      name: 'Trader Make Money',
      description: 'Граница адаптера готова. Ждём API-ключ и схему дневника.',
      status: 'Заглушка',
      tone: 'purple' as const
    },
    {
      name: 'Биржи',
      description: 'Binance, OKX и Bybit будут подключаться после локального пайплайна клипов.',
      status: 'В плане',
      tone: 'neutral' as const
    }
  ], [obs])

  return (
    <div className="grid grid-cols-12 gap-4 pb-8">
      <section className="col-span-12 xl:col-span-7">
        <ActiveTradeCard />
      </section>
      <section className="col-span-12 xl:col-span-5">
        <div className="glass-panel rounded-[24px] p-5">
          <div className="text-sm font-semibold text-zinc-300">Пайплайн клипа</div>
          <div className="mt-2 text-xs text-zinc-500">Папка сохранения: {clipDir}</div>
          <div className="mt-5 space-y-4">
            {pipelineSteps.map((step, index) => (
              <div key={step} className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-full ${index < 3 ? 'bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.7)]' : 'bg-violet-400'}`} />
                <span className="text-sm text-zinc-300">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="col-span-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {integrations.map((integration) => <IntegrationStatusCard key={integration.name} {...integration} />)}
      </section>
      <section className="col-span-12">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Очередь проверки</h2>
            <p className="mt-1 text-sm text-zinc-500">Клипы остаются локально, пока вы вручную не подтвердите загрузку в YouTube.</p>
          </div>
        </div>
        <ClipCard />
      </section>
    </div>
  )
}
