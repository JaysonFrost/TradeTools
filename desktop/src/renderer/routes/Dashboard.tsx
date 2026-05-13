import { ActiveTradeCard } from '../components/trade/ActiveTradeCard'
import { ClipCard } from '../components/trade/ClipCard'
import { IntegrationStatusCard } from '../components/integrations/IntegrationStatusCard'

const integrations = [
  { name: 'OBS Replay Buffer', description: 'Connection card is ready. Real websocket health check comes in the next phase.', status: 'Mock', tone: 'warning' as const },
  { name: 'YouTube Upload', description: 'Google OAuth is not connected yet. Manual upload queue is ready.', status: 'Setup needed', tone: 'warning' as const },
  { name: 'Trader Make Money', description: 'Waiting for API docs and key. Adapter boundary is prepared.', status: 'Stub', tone: 'purple' as const },
  { name: 'Exchange Adapters', description: 'Binance, OKX, and Bybit modules planned after local clip pipeline.', status: 'Planned', tone: 'neutral' as const }
]

export const Dashboard = () => (
  <div className="grid grid-cols-12 gap-4 pb-8">
    <section className="col-span-12 xl:col-span-7">
      <ActiveTradeCard />
    </section>
    <section className="col-span-12 xl:col-span-5">
      <div className="glass-panel rounded-[24px] p-5">
        <div className="text-sm font-semibold text-zinc-300">Clip pipeline</div>
        <div className="mt-5 space-y-4">
          {['Trade close detected', 'OBS replay saved', 'ffmpeg trim planned', 'Waiting for YouTube approval'].map((step, index) => (
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
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Review queue</h2>
          <p className="mt-1 text-sm text-zinc-500">Clips stay local until manual YouTube approval.</p>
        </div>
      </div>
      <ClipCard />
    </section>
  </div>
)
