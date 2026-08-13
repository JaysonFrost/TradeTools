import { Bell, CircleCheck, Rocket } from 'lucide-react'
import { useState } from 'react'
import type { AppPage } from '../../lib/navigation'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export type TopBarProps = {
  activePage: AppPage
  appVersion?: string
  onRunHealthCheck?: () => Promise<string>
  onOpenSetupWizard?: () => void
  onTestNotification?: () => Promise<{ ok: boolean, message: string }>
}

const pageCopy: Record<AppPage, { title: string, subtitle: string, setupLabel?: string }> = {
  video: {
    title: 'Видео сделок',
    subtitle: 'Встроенная запись окна или экрана без API, локальный буфер и очередь клипов.',
    setupLabel: 'Мастер настройки видео'
  },
  proxy: {
    title: 'Прокси',
    subtitle: 'Серверы, SSH-доступы, оплаты, цепочки и инструкции для терминалов.',
    setupLabel: 'Мастер настройки прокси'
  },
  support: {
    title: 'Сказать спасибо',
    subtitle: 'USDT-адреса в сетях TRC20, TON и BSC, QR и быстрое копирование.'
  }
}

const pageCode: Record<AppPage, string> = {
  video: 'SYS / REC-01',
  proxy: 'SYS / NET-02',
  support: 'SYS / AUX-03'
}

export const TopBar = ({ activePage, appVersion, onRunHealthCheck, onOpenSetupWizard, onTestNotification }: TopBarProps) => {
  const copy = pageCopy[activePage]
  const [notificationMessage, setNotificationMessage] = useState('')
  const [notificationTone, setNotificationTone] = useState<'neutral' | 'warning'>('neutral')
  const [testingNotification, setTestingNotification] = useState(false)
  const [checkingVideo, setCheckingVideo] = useState(false)
  const [videoCheckMessage, setVideoCheckMessage] = useState('')

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

  const checkVideo = async () => {
    if (!onRunHealthCheck) return
    setCheckingVideo(true)
    setVideoCheckMessage('')
    try {
      setVideoCheckMessage(await onRunHealthCheck())
    } catch (error) {
      setVideoCheckMessage(error instanceof Error ? error.message : 'Не удалось проверить видео')
    } finally {
      setCheckingVideo(false)
    }
  }

  const notificationMessageClass = notificationTone === 'warning'
    ? 'border-[#ff9f30]/45 bg-[#ff9f30]/10 text-amber-200'
    : 'border-[#00ff9d]/35 bg-[#00ff9d]/[0.06] text-[#b9f7dd]'

  return (
    <header className="grid gap-4 border-b border-[#294155] pb-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start xl:gap-6">
      <div className="min-w-0">
        <div data-classic-hide className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#56b5d5]">
          <span className="h-px w-8 bg-[#56b5d5]/60" aria-hidden="true" />
          {pageCode[activePage]}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-2xl font-bold uppercase tracking-[-0.035em] text-[#f0f0f0] sm:text-3xl">{copy.title}</h1>
          {appVersion && <Badge tone="neutral">v{appVersion}</Badge>}
        </div>
        <p className="mt-2 max-w-[72ch] text-sm leading-6 text-[#8b9bb4]">{copy.subtitle}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2 xl:items-end">
        <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 xl:w-auto xl:justify-end">
          <Button variant="ghost" className="px-3" title="Проверить системное уведомление" aria-label="Проверить системное уведомление" onClick={() => void testNotification()} disabled={testingNotification || !onTestNotification}><Bell size={17} strokeWidth={1.8} aria-hidden="true" /></Button>
          {copy.setupLabel && onOpenSetupWizard && <Button variant="ghost" className="flex-1 sm:flex-none" onClick={onOpenSetupWizard}><Rocket size={17} strokeWidth={1.8} className="mr-2" aria-hidden="true" />{copy.setupLabel}</Button>}
          {activePage === 'video' && <Button className="flex-1 sm:flex-none" onClick={() => void checkVideo()} disabled={checkingVideo || !onRunHealthCheck}><CircleCheck size={17} strokeWidth={1.8} className="mr-2" aria-hidden="true" />{checkingVideo ? 'Проверяем...' : 'Проверить видео'}</Button>}
        </div>
        {notificationMessage && (
          <div role="status" aria-live="polite" className={`max-w-full break-words border px-3 py-2 text-xs leading-5 xl:max-w-[520px] ${notificationMessageClass}`}>
            {notificationMessage}
          </div>
        )}
        {videoCheckMessage && (
          <div role="status" aria-live="polite" className="max-w-full break-words border border-[#56b5d5]/40 bg-[#56b5d5]/10 px-3 py-2 text-xs leading-5 text-[#d6f4ff] xl:max-w-[520px]">
            {videoCheckMessage}
          </div>
        )}
      </div>
    </header>
  )
}
