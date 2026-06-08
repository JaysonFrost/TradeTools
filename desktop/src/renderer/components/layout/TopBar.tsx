import { Bell, CircleCheck, Rocket } from 'lucide-react'
import { useState } from 'react'
import type { AppPage } from '../../lib/navigation'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export type TopBarProps = {
  activePage: AppPage
  appVersion?: string
  onRunHealthCheck?: () => void
  onOpenSetupWizard?: () => void
  onTestNotification?: () => Promise<{ ok: boolean, message: string }>
}

const pageCopy: Record<AppPage, { title: string, subtitle: string, setupLabel?: string }> = {
  video: {
    title: 'Видео сделок',
    subtitle: 'OBS Replay Buffer, Binance Futures и очередь проверки клипов.',
    setupLabel: 'Настройка видео'
  },
  proxy: {
    title: 'Прокси',
    subtitle: 'Серверы, SSH-доступы, оплаты, цепочки и инструкции для терминалов.',
    setupLabel: 'Настройка прокси'
  },
  support: {
    title: 'Сказать спасибо',
    subtitle: 'USDT-адреса в сетях TRC20, TON и BSC, QR и быстрое копирование.'
  }
}

export const TopBar = ({ activePage, appVersion, onRunHealthCheck = () => undefined, onOpenSetupWizard, onTestNotification }: TopBarProps) => {
  const copy = pageCopy[activePage]
  const [notificationMessage, setNotificationMessage] = useState('')
  const [notificationTone, setNotificationTone] = useState<'neutral' | 'warning'>('neutral')
  const [testingNotification, setTestingNotification] = useState(false)

  const testNotification = async () => {
    if (!onTestNotification) return
    setTestingNotification(true)
    setNotificationMessage('')
    setNotificationTone('neutral')
    try {
      const result = await onTestNotification()
      setNotificationMessage(result.ok ? result.message : `Не удалось отправить уведомление: ${result.message}`)
      setNotificationTone(result.ok ? 'neutral' : 'warning')
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : 'Не удалось отправить уведомление')
      setNotificationTone('warning')
    } finally {
      setTestingNotification(false)
    }
  }

  return (
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between xl:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{copy.title}</h1>
          {appVersion && <Badge tone="neutral">v{appVersion}</Badge>}
        </div>
        <p className="mt-2 text-sm text-zinc-400">{copy.subtitle}</p>
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:gap-3 xl:w-auto xl:justify-end">
        <Button variant="ghost" className="px-3" title="Проверить системное уведомление" onClick={() => void testNotification()} disabled={testingNotification || !onTestNotification}><Bell size={17} /></Button>
        {copy.setupLabel && onOpenSetupWizard && <Button variant="ghost" className="flex-1 sm:flex-none" onClick={onOpenSetupWizard}><Rocket size={17} className="mr-2" />{copy.setupLabel}</Button>}
        {activePage === 'video' && <Button className="flex-1 sm:flex-none" onClick={onRunHealthCheck}><CircleCheck size={17} className="mr-2" />Проверить видео</Button>}
        {notificationMessage && <span className={`w-full text-xs sm:w-auto ${notificationTone === 'warning' ? 'text-amber-300' : 'text-zinc-400'}`}>{notificationMessage}</span>}
      </div>
    </header>
  )
}
