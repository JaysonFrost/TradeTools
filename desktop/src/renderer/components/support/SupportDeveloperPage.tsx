import QRCode from 'react-qr-code'
import { CheckCircle2, Copy, Heart, ShieldCheck, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'

type DonationWalletId = 'usdt-trc20' | 'ton' | 'bsc'

type DonationWallet = {
  id: DonationWalletId
  asset: string
  network: string
  address: string
  hint: string
  accent: string
}

const donationWallets: DonationWallet[] = [
  {
    id: 'usdt-trc20',
    asset: 'USDT',
    network: 'TRC20',
    address: 'TGKPUrzVehY2J46RC4T5xEzxhYNbFYE3YV',
    hint: 'USDT в сети Tron',
    accent: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  },
  {
    id: 'ton',
    asset: 'USDT',
    network: 'TON',
    address: 'UQA_cTGdBPjPe8oXyQ8pLGI-tTCMzwPuyDIV0tcrnSeN9sUm',
    hint: 'USDT в сети The Open Network',
    accent: 'border-sky-400/30 bg-sky-400/10 text-sky-200'
  },
  {
    id: 'bsc',
    asset: 'USDT',
    network: 'BSC',
    address: '0x66E24766Bde46D15b571b78C0483d361d0931F90',
    hint: 'USDT в сети BNB Smart Chain (BEP20)',
    accent: 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  }
]

const writeClipboard = async (text: string): Promise<void> => {
  try {
    await getTradeToolsApi().clipboard.writeText(text)
    return
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

export const SupportDeveloperPage = () => {
  const [copiedWalletId, setCopiedWalletId] = useState<DonationWalletId>()
  const [message, setMessage] = useState('')

  const copyAddress = async (wallet: DonationWallet) => {
    try {
      await writeClipboard(wallet.address)
      setCopiedWalletId(wallet.id)
      setMessage(`${wallet.asset} ${wallet.network}: адрес скопирован`)
    } catch {
      setMessage('Не удалось скопировать адрес')
    }
  }

  return (
    <div className="mt-6 grid grid-cols-12 gap-4 pb-8">
      <section className="col-span-12 overflow-hidden rounded-[24px] border border-white/[0.07] bg-white/[0.035] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="purple">TradeTools</Badge>
              <Badge tone="neutral">Спасибо за поддержку</Badge>
            </div>
            <h2 className="m-0 text-2xl font-semibold tracking-[-0.04em] text-zinc-50">Сказать спасибо автору</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              USDT-донаты помогают держать проект бесплатным, чинить запись сделок и быстрее добавлять удобные инструменты для торговли.
            </p>
          </div>
          <div className="flex max-w-md items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-5 text-amber-100">
            <ShieldCheck className="mt-0.5 shrink-0" size={18} />
            <span>Перед отправкой проверьте сеть кошелька. Перевод в другой сети может не дойти.</span>
          </div>
        </div>
      </section>

      <section className="col-span-12 grid gap-4 xl:grid-cols-3">
        {donationWallets.map((wallet) => {
          const copied = copiedWalletId === wallet.id

          return (
            <Card key={wallet.id} className="flex min-h-[420px] flex-col gap-4 overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${wallet.accent}`}>
                      <Wallet size={14} />
                      {wallet.asset}
                    </span>
                    <Badge tone="neutral">{wallet.network}</Badge>
                  </div>
                  <h3 className="m-0 text-xl font-semibold tracking-[-0.03em]">{wallet.asset} {wallet.network}</h3>
                  <p className="mt-1 text-sm text-zinc-500">{wallet.hint}</p>
                </div>
                <Heart className="shrink-0 text-violet-300" size={20} />
              </div>

              <div className="flex flex-1 items-center justify-center rounded-[20px] border border-white/10 bg-white p-4" role="img" aria-label={`QR ${wallet.asset} ${wallet.network}`}>
                <QRCode
                  bgColor="#ffffff"
                  fgColor="#08090a"
                  level="M"
                  size={220}
                  style={{ height: 'auto', maxWidth: '220px', width: '100%' }}
                  value={wallet.address}
                />
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">Адрес</div>
                <div className="break-all font-mono text-sm leading-6 text-zinc-100">{wallet.address}</div>
              </div>

              <Button className="w-full" onClick={() => void copyAddress(wallet)}>
                {copied ? <CheckCircle2 size={17} className="mr-2" /> : <Copy size={17} className="mr-2" />}
                {copied ? 'Скопировано' : 'Скопировать адрес'}
              </Button>
            </Card>
          )
        })}
      </section>

      {message && (
        <div className="col-span-12 rounded-2xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100">
          {message}
        </div>
      )}
    </div>
  )
}
