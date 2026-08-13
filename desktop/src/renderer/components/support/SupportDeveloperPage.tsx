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
    address: 'TQZ8mz9op6xagjTfqSY91QMXtiBibUJ94r',
    hint: 'USDT в сети Tron',
    accent: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  },
  {
    id: 'ton',
    asset: 'USDT',
    network: 'TON',
    address: 'UQA_cTGdBPjPe8oXyQ8pLGI-tTCMzwPuyDIV0tcrnSeN9sUm',
    hint: 'USDT в сети The Open Network',
    accent: 'border-[#56b5d5]/30 bg-[#56b5d5]/10 text-cyan-200'
  },
  {
    id: 'bsc',
    asset: 'USDT',
    network: 'BSC',
    address: '0x83e7c66a1c3f92c4676333fc3cb9446d194a8f7b',
    hint: 'USDT в сети BNB Smart Chain (BEP20)',
    accent: 'border-[#ff9f30]/30 bg-[#ff9f30]/10 text-orange-200'
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
    <div className="mt-6 grid grid-cols-12 gap-4 pb-8 font-mono">
      <section className="classic-rounded col-span-12 overflow-hidden border border-cyan-400/25 bg-[#0b1623] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="success">TradeTools</Badge>
              <Badge tone="neutral">Спасибо за поддержку</Badge>
            </div>
            <h2 className="m-0 text-2xl font-semibold tracking-[-0.04em] text-[#f0f0f0]">Сказать спасибо автору</h2>
            <p className="mt-2 text-sm leading-6 text-[#8b9bb4]">
              USDT-донаты помогают держать проект бесплатным, чинить запись сделок и быстрее добавлять удобные инструменты для торговли.
            </p>
          </div>
          <div className="classic-control flex max-w-md items-start gap-3 border border-orange-400/35 bg-orange-400/10 p-4 text-sm leading-5 text-orange-100">
            <ShieldCheck className="mt-0.5 shrink-0" size={18} />
            <span>Перед отправкой проверьте сеть кошелька. Перевод в другой сети может не дойти.</span>
          </div>
        </div>
      </section>

      <section className="col-span-12 grid gap-4 xl:grid-cols-2">
        {donationWallets.map((wallet) => {
          const copied = copiedWalletId === wallet.id

          return (
            <Card key={wallet.id} className="flex min-h-[420px] flex-col gap-4 overflow-hidden rounded-none border-[#1c2b3a] bg-[#0b1623] shadow-none backdrop-blur-none">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-2 border px-2.5 py-1 text-xs font-semibold ${wallet.accent}`}>
                      <Wallet size={14} />
                      {wallet.asset}
                    </span>
                    <Badge tone="neutral">{wallet.network}</Badge>
                  </div>
                  <h3 className="m-0 text-xl font-semibold tracking-[-0.03em]">{wallet.asset} {wallet.network}</h3>
                  <p className="mt-1 text-sm text-[#8b9bb4]">{wallet.hint}</p>
                </div>
                <Heart className="shrink-0 text-orange-300" size={20} />
              </div>

              <div className="classic-rounded flex flex-1 items-center justify-center border border-cyan-400/25 bg-[#f0f0f0] p-4" role="img" aria-label={`QR ${wallet.asset} ${wallet.network}`}>
                <QRCode
                  bgColor="#f0f0f0"
                  fgColor="#0b1623"
                  level="M"
                  size={220}
                  style={{ height: 'auto', maxWidth: '220px', width: '100%' }}
                  value={wallet.address}
                />
              </div>

              <div className="classic-control border border-[#1c2b3a] bg-[#07111c] p-3">
                <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-[#8b9bb4]">Адрес</div>
                <div className="break-all text-sm leading-6 text-[#f0f0f0]">{wallet.address}</div>
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
        <div className="classic-control col-span-12 border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100" role="status">
          {message}
        </div>
      )}
    </div>
  )
}
