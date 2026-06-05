import { ArrowLeft, ArrowRight, CheckCircle2, FolderOpen, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import { getTradeCutApi } from '../../lib/tradeCutApi'
import { setupWizardSteps } from './setupWizardSteps'
import { Button } from '../ui/Button'

export type SetupWizardProps = {
  open: boolean
  settings?: AppSettings
  obsMessage: string
  clipMessage: string
  onClose: () => void
  onSaved: (settings: AppSettings) => void
  onRunHealthCheck: () => Promise<void>
  onCreateTestClip: () => Promise<void>
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'

export const SetupWizard = ({ open, settings, obsMessage, clipMessage, onClose, onSaved, onRunHealthCheck, onCreateTestClip }: SetupWizardProps) => {
  const [stepIndex, setStepIndex] = useState(0)
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4455')
  const [obsPassword, setObsPassword] = useState('')
  const [replaySourceDir, setReplaySourceDir] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [paddingBefore, setPaddingBefore] = useState('3')
  const [paddingAfter, setPaddingAfter] = useState('5')
  const [saving, setSaving] = useState(false)
  const [localMessage, setLocalMessage] = useState('')

  useEffect(() => {
    if (!settings) return
    setHost(settings.obs.host)
    setPort(String(settings.obs.port))
    setReplaySourceDir(settings.clip.replaySourceDir)
    setOutputDir(settings.clip.outputDir)
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
  }, [settings])

  const step = setupWizardSteps[stepIndex]
  const progress = useMemo(() => Math.round(((stepIndex + 1) / setupWizardSteps.length) * 100), [stepIndex])

  if (!open) return null

  const saveSettings = async () => {
    setSaving(true)
    setLocalMessage('')
    try {
      const api = getTradeCutApi()
      const updated = await api.settings.update({
        obsPassword: obsPassword.trim() || undefined,
        obs: {
          host,
          port: Number(port)
        },
        clip: {
          replaySourceDir,
          outputDir,
          paddingBeforeSeconds: Number(paddingBefore),
          paddingAfterSeconds: Number(paddingAfter)
        }
      })
      onSaved(updated)
      setObsPassword('')
      setLocalMessage('Настройки сохранены')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось сохранить настройки')
    } finally {
      setSaving(false)
    }
  }

  const selectDirectory = async (currentPath: string, setValue: (value: string) => void) => {
    try {
      const api = getTradeCutApi()
      const selectedPath = await api.dialog.selectDirectory(currentPath.trim() || undefined)
      if (!selectedPath) return
      setValue(selectedPath)
      setLocalMessage('Папка выбрана. Не забудьте сохранить этот шаг.')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось открыть выбор папки')
    }
  }

  const runStepAction = async (actionIndex: number) => {
    setLocalMessage('')

    if (step.id === 'welcome') {
      setStepIndex(actionIndex === 0 ? 1 : actionIndex === 1 ? 3 : 5)
      return
    }

    if (step.id === 'obs-websocket') {
      setLocalMessage(actionIndex === 3 ? 'Введите пароль ниже и нажмите «Сохранить этот шаг».' : 'Выполните этот пункт в OBS, затем вернитесь в мастер.')
      return
    }

    if (step.id === 'obs-replay') {
      if (actionIndex === step.actions.length - 1) {
        await onRunHealthCheck()
      } else {
        setLocalMessage('Выполните этот пункт в OBS. После запуска Replay Buffer нажмите проверку системы.')
      }
      return
    }

    if (step.id === 'folders') {
      if (actionIndex === 0) {
        await selectDirectory(replaySourceDir, setReplaySourceDir)
      } else if (actionIndex === 1) {
        await selectDirectory(outputDir, setOutputDir)
      } else {
        setLocalMessage('Задайте отступы ниже и нажмите «Сохранить этот шаг».')
      }
      return
    }

    if (step.id === 'test-clip') {
      await onCreateTestClip()
      return
    }

    if (step.id === 'done') {
      if (actionIndex === 2) setStepIndex(1)
      else onClose()
      return
    }

    setLocalMessage('Этот пункт пока информационный.')
  }

  const next = () => setStepIndex((value) => Math.min(value + 1, setupWizardSteps.length - 1))
  const previous = () => setStepIndex((value) => Math.max(value - 1, 0))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-xl">
      <div className="flex max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0c10] shadow-[0_24px_90px_rgba(0,0,0,0.65)]">
        <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-white/[0.03] p-5 lg:block">
          <div className="text-sm font-semibold text-zinc-200">Пошаговая настройка</div>
          <div className="mt-2 h-2 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-5 space-y-2">
            {setupWizardSteps.map((item, index) => (
              <button
                key={item.id}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition ${index === stepIndex ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'}`}
                onClick={() => setStepIndex(index)}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${index < stepIndex ? 'bg-emerald-400 text-black' : index === stepIndex ? 'bg-violet-500 text-white' : 'bg-white/10 text-zinc-500'}`}>{index < stepIndex ? '✓' : index + 1}</span>
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 p-6">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-violet-300">Шаг {stepIndex + 1} из {setupWizardSteps.length}</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-zinc-100">{step.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{step.goal}</p>
            </div>
            <button className="cursor-pointer rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-zinc-400 transition hover:text-zinc-100" onClick={onClose} aria-label="Закрыть пошаговую настройку">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                <div className="space-y-3">
                  {step.actions.map((action, index) => (
                    <button key={action} type="button" className="flex w-full cursor-pointer gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-left text-sm text-zinc-300 transition hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-zinc-100" onClick={() => void runStepAction(index)}>
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-violet-300" />
                      <span>{action}</span>
                    </button>
                  ))}
                </div>
                {step.id === 'obs-websocket' && (
                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <label className="text-xs font-medium text-zinc-500">OBS host<input className={inputClass} value={host} onChange={(event) => setHost(event.target.value)} /></label>
                    <label className="text-xs font-medium text-zinc-500">OBS port<input className={inputClass} value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" /></label>
                    <label className="text-xs font-medium text-zinc-500">OBS пароль<input className={inputClass} value={obsPassword} onChange={(event) => setObsPassword(event.target.value)} type="password" placeholder={settings?.obs.passwordConfigured ? 'Сохранён' : 'Не задан'} /></label>
                  </div>
                )}
                {step.id === 'folders' && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <div className="text-xs font-medium text-zinc-500">Папка OBS replay</div>
                      <div className="mt-1 flex gap-2">
                        <input className={inputClass.replace('mt-1 ', '')} value={replaySourceDir} onChange={(event) => setReplaySourceDir(event.target.value)} />
                        <Button variant="ghost" onClick={() => void selectDirectory(replaySourceDir, setReplaySourceDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <div className="text-xs font-medium text-zinc-500">Папка клипов</div>
                      <div className="mt-1 flex gap-2">
                        <input className={inputClass.replace('mt-1 ', '')} value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
                        <Button variant="ghost" onClick={() => void selectDirectory(outputDir, setOutputDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
                      </div>
                    </div>
                    <label className="text-xs font-medium text-zinc-500">Секунд до входа<input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" /></label>
                    <label className="text-xs font-medium text-zinc-500">Секунд после выхода<input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" /></label>
                  </div>
                )}
                {step.id === 'obs-replay' && <Button className="mt-5" onClick={onRunHealthCheck}>Проверить систему</Button>}
                {step.id === 'test-clip' && <Button className="mt-5" onClick={onCreateTestClip}>Создать тестовый клип</Button>}
                {(step.id === 'obs-websocket' || step.id === 'folders') && <Button className="mt-5" onClick={saveSettings} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить этот шаг'}</Button>}
                {(localMessage || obsMessage || clipMessage) && (
                  <div className="mt-5 rounded-2xl border border-violet-400/20 bg-violet-400/10 p-3 text-sm text-violet-100">
                    {localMessage || clipMessage || obsMessage}
                  </div>
                )}
              </section>
              <aside className="rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-5">
                <div className="text-sm font-semibold text-violet-100">Что получится после шага</div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {step.id === 'welcome' && 'Вы поймёте весь путь настройки и сможете пройти его без поиска по интерфейсу.'}
                  {step.id === 'obs-websocket' && 'Приложение сможет безопасно подключаться к OBS и отправлять команду сохранения replay.'}
                  {step.id === 'obs-replay' && 'OBS начнет держать последние минуты записи в памяти и отдавать их по команде.'}
                  {step.id === 'folders' && 'TradeCut будет знать, где найти исходный replay и куда положить готовый клип.'}
                  {step.id === 'trade-source' && 'Сейчас используем тестовую сделку, а позже сюда подключается дневник или биржа.'}
                  {step.id === 'test-clip' && 'В очереди проверки появится реальный локальный MP4 с metadata JSON.'}
                  {step.id === 'done' && 'Можно закрыть мастер и пользоваться основным экраном.'}
                </p>
              </aside>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 p-6">
            <Button variant="ghost" onClick={previous} disabled={stepIndex === 0}><ArrowLeft size={16} className="mr-2" />Назад</Button>
            {stepIndex === setupWizardSteps.length - 1 ? <Button onClick={onClose}>Закрыть мастер</Button> : <Button onClick={next}>Дальше<ArrowRight size={16} className="ml-2" /></Button>}
          </div>
        </main>
      </div>
    </div>
  )
}
