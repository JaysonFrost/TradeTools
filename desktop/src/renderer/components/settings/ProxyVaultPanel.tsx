import { ArrowDown, ArrowUp, CalendarClock, ExternalLink, GripVertical, KeyRound, Pencil, Plus, Power, Route, Save, Server, ShieldAlert, Trash2, UserRound, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AppSettings, ProxyRecord } from '../../../main/services/settings/settings'
import type { ProxyChainConnectionResult, ProxyChainInstructionResult, ProxyChainSetupProgress, ProxyChainSetupResult, VpnBypassRouteResult, VpnBypassStatus } from '../../../preload'
import { defaultLocalProxyPort } from '../../../shared/defaults'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { createProxyConnectionSummary } from './proxyConnectionState'

export type ProxyVaultPanelProps = {
  settings?: AppSettings
  onSaved: (settings: AppSettings) => void
  runtimeState: ProxyVaultRuntimeState
  onRuntimeStateChange: Dispatch<SetStateAction<ProxyVaultRuntimeState>>
}

export type ProxyVaultRuntimeState = {
  chainResult?: ProxyChainInstructionResult
  chainCheckProgress: ProxyChainSetupProgress[]
  chainSetupResult?: ProxyChainSetupResult
  chainSetupProgress: ProxyChainSetupProgress[]
  vpnBypassResult?: VpnBypassRouteResult
  connectionResult?: ProxyChainConnectionResult
  vpnBypassStatus?: VpnBypassStatus
  activeOperation?: 'check' | 'connect' | 'disconnect' | 'vpn-bypass'
}

type ProxyFormState = {
  id: string
  name: string
  server: string
  login: string
  password: string
  localProxyPort: string
  paymentDueDay: string
  dashboardUrl: string
  notes: string
}

const proxyPresetNames = ['Edgecenter', 'Vultr']

const currentPaymentDueDay = (): string => String(new Date().getDate())
const defaultProxyName = (settings?: AppSettings): string => proxyPresetNames[settings?.proxies.length ?? 0] ?? ''

const createEmptyForm = (settings?: AppSettings): ProxyFormState => ({
  id: '',
  name: defaultProxyName(settings),
  server: '',
  login: 'root',
  password: '',
  localProxyPort: String(defaultLocalProxyPort),
  paymentDueDay: currentPaymentDueDay(),
  dashboardUrl: '',
  notes: ''
})

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'
const compactButtonClass = 'h-9 px-3'

const dayMs = 24 * 60 * 60 * 1000

const startOfTodayMs = (): number => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

const daysInMonth = (year: number, monthIndex: number): number => new Date(year, monthIndex + 1, 0).getDate()

const monthlyDueAtMs = (year: number, monthIndex: number, paymentDueDay: number): number => {
  return new Date(year, monthIndex, Math.min(paymentDueDay, daysInMonth(year, monthIndex))).getTime()
}

const nextMonthlyDueAtMs = (paymentDueDay: number): number | undefined => {
  if (!paymentDueDay) return undefined
  const now = new Date()
  const todayMs = startOfTodayMs()
  const thisMonthDueMs = monthlyDueAtMs(now.getFullYear(), now.getMonth(), paymentDueDay)
  if (thisMonthDueMs >= todayMs) return thisMonthDueMs

  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return monthlyDueAtMs(nextMonth.getFullYear(), nextMonth.getMonth(), paymentDueDay)
}

const daysUntilPayment = (proxy: ProxyRecord): number | undefined => {
  const dueAtMs = nextMonthlyDueAtMs(proxy.paymentDueDay)
  if (!dueAtMs) return undefined
  return Math.ceil((dueAtMs - startOfTodayMs()) / dayMs)
}

const paymentBadge = (proxy: ProxyRecord) => {
  const daysUntil = daysUntilPayment(proxy)
  if (daysUntil === undefined) return { label: 'День оплаты не задан', tone: 'neutral' as const }
  if (daysUntil === 0) return { label: 'Оплата сегодня', tone: 'warning' as const }
  if (daysUntil <= 5) return { label: `Оплата через ${daysUntil} дн.`, tone: 'warning' as const }
  return { label: `Оплата ${proxy.paymentDueDay} числа`, tone: 'success' as const }
}

const proxyName = (proxy: ProxyRecord): string => proxy.name || proxy.server || 'Сервер'

const sortProxies = (proxies: ProxyRecord[]): ProxyRecord[] => [...proxies].sort((a, b) => {
  const aDue = nextMonthlyDueAtMs(a.paymentDueDay) ?? Number.MAX_SAFE_INTEGER
  const bDue = nextMonthlyDueAtMs(b.paymentDueDay) ?? Number.MAX_SAFE_INTEGER
  return aDue - bDue || proxyName(a).localeCompare(proxyName(b))
})

const routeText = (proxy: ProxyRecord, byId: Map<string, ProxyRecord>): string => {
  const parts = [`${proxyName(proxy)} (${proxy.server || 'IP не задан'})`]
  const visited = new Set([proxy.id])
  let current = proxy

  while (current.nextProxyId) {
    const next = byId.get(current.nextProxyId)
    if (!next || visited.has(next.id)) break
    visited.add(next.id)
    parts.push(`${proxyName(next)} (${next.server || 'IP не задан'})`)
    current = next
  }

  return parts.join(' -> ')
}

const buildChainOrderIds = (proxies: ProxyRecord[]): string[] => {
  const byId = new Map(proxies.map((proxy) => [proxy.id, proxy]))
  const targetedIds = new Set(proxies.map((proxy) => proxy.nextProxyId).filter((id) => byId.has(id)))
  const heads = proxies.filter((proxy) => !targetedIds.has(proxy.id))
  const startPoints = heads.length > 0 ? heads : proxies.slice(0, 1)
  const visited = new Set<string>()
  const orderedIds: string[] = []

  for (const start of startPoints) {
    let current: ProxyRecord | undefined = start
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      orderedIds.push(current.id)
      current = current.nextProxyId ? byId.get(current.nextProxyId) : undefined
    }
  }

  for (const proxy of proxies) {
    if (!visited.has(proxy.id)) orderedIds.push(proxy.id)
  }

  return orderedIds
}

const reorderIds = (ids: string[], sourceId: string, targetId: string): string[] => {
  if (sourceId === targetId) return ids
  const sourceIndex = ids.indexOf(sourceId)
  const targetIndex = ids.indexOf(targetId)
  if (sourceIndex < 0 || targetIndex < 0) return ids

  const nextIds = [...ids]
  const [source] = nextIds.splice(sourceIndex, 1)
  nextIds.splice(targetIndex, 0, source)
  return nextIds
}

const moveIdByOffset = (ids: string[], id: string, offset: number): string[] => {
  const index = ids.indexOf(id)
  const nextIndex = index + offset
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids

  const nextIds = [...ids]
  const [source] = nextIds.splice(index, 1)
  nextIds.splice(nextIndex, 0, source)
  return nextIds
}

const progressStatusLabel = (status: ProxyChainSetupProgress['status']): string => {
  if (status === 'success') return 'OK'
  if (status === 'error') return 'ERR'
  if (status === 'info') return 'INFO'
  return '...'
}

const progressStatusClass = (status: ProxyChainSetupProgress['status']): string => {
  if (status === 'success') return 'text-emerald-300'
  if (status === 'error') return 'text-rose-300'
  if (status === 'info') return 'text-amber-300'
  return 'text-sky-300'
}

type NetworkDiagnosticsSnapshot = ProxyChainSetupResult['network']

const networkStatusClass = (status: NetworkDiagnosticsSnapshot['diagnostics'][number]['status']): string => {
  if (status === 'ok') return 'text-emerald-200'
  if (status === 'warning') return 'text-amber-200'
  return 'text-sky-200'
}

const networkStatusBorderClass = (status: NetworkDiagnosticsSnapshot['diagnostics'][number]['status']): string => {
  if (status === 'ok') return 'border-emerald-400/20 bg-emerald-400/10'
  if (status === 'warning') return 'border-amber-400/20 bg-amber-400/10'
  return 'border-sky-400/20 bg-sky-400/10'
}

const networkStatusLabel = (status: NetworkDiagnosticsSnapshot['diagnostics'][number]['status']): string => {
  if (status === 'ok') return 'OK'
  if (status === 'warning') return 'Внимание'
  return 'Info'
}

const NetworkDiagnosticsBlock = ({ network }: { network?: NetworkDiagnosticsSnapshot }) => {
  if (!network) return null

  const hasWarning = network.likelyVpnActive || network.systemProxyEnabled || network.diagnostics.some((diagnostic) => diagnostic.status === 'warning')

  return (
    <div className={`mt-3 rounded-2xl border p-4 ${hasWarning ? 'border-amber-400/20 bg-amber-400/10' : 'border-white/10 bg-black/20'}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <ShieldAlert size={16} className={hasWarning ? 'text-amber-200' : 'text-emerald-200'} />
        <span>VPN и маршрут</span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {network.diagnostics.map((diagnostic) => (
          <div key={`${diagnostic.name}-${diagnostic.message}`} className={`rounded-xl border px-3 py-2 ${networkStatusBorderClass(diagnostic.status)}`}>
            <div className={`text-[11px] font-semibold uppercase ${networkStatusClass(diagnostic.status)}`}>{networkStatusLabel(diagnostic.status)}</div>
            <div className="mt-1 text-xs font-semibold text-zinc-100">{diagnostic.name}</div>
            <div className="mt-1 break-words text-xs leading-5 text-zinc-400">{diagnostic.message}</div>
          </div>
        ))}
      </div>
      {network.advice.length > 0 && (
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs leading-5 text-zinc-300">
          {network.advice.map((item) => <li key={item}>{item}</li>)}
        </ol>
      )}
    </div>
  )
}

const VpnBypassResultBlock = ({ result }: { result?: VpnBypassRouteResult }) => {
  if (!result) return null

  return (
    <div className={`mt-4 rounded-2xl border p-4 text-xs leading-5 ${result.ok ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-amber-400/20 bg-amber-400/10'}`}>
      <div className={`text-sm font-semibold ${result.ok ? 'text-emerald-100' : 'text-amber-100'}`}>Обход VPN для VPS</div>
      <div className="mt-2 break-words text-zinc-300">{result.message}</div>
      {result.gateway && (
        <div className="mt-2 text-zinc-400">
          Gateway: {result.gateway}{result.interfaceName ? `, интерфейс: ${result.interfaceName}` : ''}
        </div>
      )}
      {result.routes.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {result.routes.map((route) => (
            <div key={`${route.address}-${route.host}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className={route.ok ? 'font-semibold text-emerald-200' : 'font-semibold text-amber-200'}>{route.address}</div>
              <div className="mt-1 break-words text-zinc-400">{route.host}: {route.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const userFacingErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

export const ProxyVaultPanel = ({ settings, onSaved, runtimeState, onRuntimeStateChange }: ProxyVaultPanelProps) => {
  const [form, setForm] = useState<ProxyFormState>(() => createEmptyForm(settings))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [localProxyRunning, setLocalProxyRunning] = useState(false)
  const [localProxyType, setLocalProxyType] = useState<AppSettings['proxyRuntime']['localProxyType']>(settings?.proxyRuntime.localProxyType ?? 'SOCKS5')
  const localProxyStatusRefresh = useRef<Promise<void>>(Promise.resolve())
  const localProxyStatusMounted = useRef(true)
  const [chainOrderIds, setChainOrderIds] = useState<string[]>(() => buildChainOrderIds(settings?.proxies ?? []))
  const [draggedProxyId, setDraggedProxyId] = useState('')
  const proxies = useMemo(() => sortProxies(settings?.proxies ?? []), [settings?.proxies])
  const proxyById = useMemo(() => new Map((settings?.proxies ?? []).map((proxy) => [proxy.id, proxy])), [settings?.proxies])
  const editedProxy = settings?.proxies.find((proxy) => proxy.id === form.id)
  const orderedChainProxies = useMemo(
    () => chainOrderIds.map((id) => proxyById.get(id)).filter((proxy): proxy is ProxyRecord => proxy !== undefined),
    [chainOrderIds, proxyById]
  )
  const chainOrderDirty = useMemo(() => {
    const currentProxies = settings?.proxies ?? []
    if (currentProxies.length !== chainOrderIds.length) return currentProxies.length > 0

    return currentProxies.some((proxy) => {
      const index = chainOrderIds.indexOf(proxy.id)
      const expectedNextProxyId = index >= 0 ? chainOrderIds[index + 1] ?? '' : ''
      return proxy.nextProxyId !== expectedNextProxyId
    })
  }, [chainOrderIds, settings?.proxies])
  const busy = saving || runtimeState.activeOperation !== undefined
  const { chainResult, chainCheckProgress, chainSetupResult, chainSetupProgress, vpnBypassResult, connectionResult, vpnBypassStatus } = runtimeState

  const updateRuntimeState = (patch: Partial<ProxyVaultRuntimeState>) => {
    onRuntimeStateChange((current) => ({ ...current, ...patch }))
  }

  const clearCheckState = () => updateRuntimeState({ chainResult: undefined, chainCheckProgress: [] })
  const clearSetupState = () => updateRuntimeState({ chainSetupResult: undefined, chainSetupProgress: [] })
  const refreshLocalProxyRuntimeStatus = (): Promise<void> => {
    const refresh = localProxyStatusRefresh.current
      .then(() => getTradeToolsApi().proxies.getLocalRuntimeStatus())
      .then((running) => {
        if (localProxyStatusMounted.current) setLocalProxyRunning(running)
      })
      .catch(() => undefined)
    localProxyStatusRefresh.current = refresh
    return refresh
  }

  const connectionSummary = createProxyConnectionSummary({
    connected: localProxyRunning,
    connecting: runtimeState.activeOperation === 'connect',
    bypassState: vpnBypassStatus?.state
  })

  useEffect(() => {
    setChainOrderIds(buildChainOrderIds(settings?.proxies ?? []))
  }, [settings?.proxies])

  useEffect(() => {
    if (settings?.proxyRuntime.localProxyType) setLocalProxyType(settings.proxyRuntime.localProxyType)
  }, [settings?.proxyRuntime.localProxyType])

  useEffect(() => {
    const api = getTradeToolsApi()
    let active = true
    void api.proxies.getVpnBypassStatus().then((status) => {
      if (active) updateRuntimeState({ vpnBypassStatus: status })
    }).catch(() => undefined)
    const unsubscribe = api.proxies.onVpnBypassStatus((status) => {
      if (active) updateRuntimeState({ vpnBypassStatus: status })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    localProxyStatusMounted.current = true
    const refresh = () => void refreshLocalProxyRuntimeStatus()
    refresh()
    const refreshInterval = setInterval(refresh, 5_000)
    return () => {
      localProxyStatusMounted.current = false
      clearInterval(refreshInterval)
    }
  }, [])

  useEffect(() => {
    if (!settings || !form.id) return
    if (!settings.proxies.some((proxy) => proxy.id === form.id)) setForm(createEmptyForm(settings))
  }, [form.id, settings])

  useEffect(() => {
    if (!settings || form.id) return
    const canRefreshDefaultName = !form.server && !form.login && !form.password && !form.dashboardUrl && !form.notes && (!form.name || proxyPresetNames.includes(form.name))
    if (canRefreshDefaultName && (form.name !== defaultProxyName(settings) || !form.paymentDueDay)) {
      setForm((current) => ({ ...createEmptyForm(settings), paymentDueDay: current.paymentDueDay || currentPaymentDueDay() }))
    }
  }, [form, settings])

  const updateForm = (patch: Partial<ProxyFormState>) => setForm((current) => ({ ...current, ...patch }))

  const editProxy = (proxy: ProxyRecord) => {
    setForm({
      id: proxy.id,
      name: proxy.name,
      server: proxy.server,
      login: proxy.login,
      password: '',
      localProxyPort: proxy.localProxyPort ? String(proxy.localProxyPort) : String(defaultLocalProxyPort),
      paymentDueDay: proxy.paymentDueDay ? String(proxy.paymentDueDay) : currentPaymentDueDay(),
      dashboardUrl: proxy.dashboardUrl,
      notes: proxy.notes
    })
    setMessage('')
  }

  const resetForm = () => {
    setForm(createEmptyForm(settings))
    setMessage('')
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const updated = await getTradeToolsApi().proxies.save({
        id: form.id || undefined,
        name: form.name,
        server: form.server,
        login: form.login,
        password: form.password || undefined,
        nextProxyId: editedProxy?.nextProxyId ?? '',
        localProxyPort: Number(form.localProxyPort) || defaultLocalProxyPort,
        paymentDueDay: Number(form.paymentDueDay) || undefined,
        dashboardUrl: form.dashboardUrl,
        notes: form.notes
      })
      onSaved(updated)
      setForm(createEmptyForm(updated))
      setMessage('Сервер сохранён')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить сервер')
    } finally {
      setSaving(false)
    }
  }

  const copyText = async (text: string, successMessage: string) => {
    if (!text) return
    try {
      await getTradeToolsApi().clipboard.writeText(text)
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось скопировать')
    }
  }

  const copyPassword = async (proxy: ProxyRecord) => {
    try {
      await getTradeToolsApi().proxies.copyPassword(proxy.id)
      setMessage(`Пароль скопирован: ${proxyName(proxy)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось скопировать пароль')
    }
  }

  const openDashboard = async (proxy: ProxyRecord) => {
    try {
      await getTradeToolsApi().proxies.openDashboard(proxy.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось открыть кабинет')
    }
  }

  const configureChain = async (proxy: ProxyRecord) => {
    setSaving(true)
    setMessage('')
    updateRuntimeState({
      activeOperation: 'check',
      chainResult: undefined,
      chainCheckProgress: []
    })
    try {
      const result = await getTradeToolsApi().proxies.configureChain(proxy.id)
      updateRuntimeState({ chainResult: result })
      setMessage('SSH-подключение проверено, инструкция готова')
    } catch (error) {
      setMessage(userFacingErrorMessage(error, 'Не удалось подготовить связку'))
    } finally {
      setSaving(false)
      onRuntimeStateChange((current) => ({
        ...current,
        activeOperation: current.activeOperation === 'check' ? undefined : current.activeOperation
      }))
    }
  }

  const saveChainOrder = async (successMessage = 'Порядок связки сохранён'): Promise<AppSettings | undefined> => {
    if (!settings) return undefined

    setSaving(true)
    setMessage('')
    try {
      const nextById = new Map(chainOrderIds.map((id, index) => [id, chainOrderIds[index + 1] ?? '']))
      const updated = await getTradeToolsApi().settings.update({
        proxies: settings.proxies.map((proxy) => ({
          ...proxy,
          nextProxyId: nextById.get(proxy.id) ?? ''
        }))
      })
      onSaved(updated)
      clearCheckState()
      setMessage(successMessage)
      return updated
    } catch (error) {
      setMessage(userFacingErrorMessage(error, 'Не удалось сохранить порядок связки'))
      return undefined
    } finally {
      setSaving(false)
    }
  }

  const configureOrderedChain = async () => {
    const firstProxyId = chainOrderIds[0]
    const firstProxy = firstProxyId ? proxyById.get(firstProxyId) : undefined
    if (!firstProxy) {
      setMessage('Добавьте серверы, затем соберите связку')
      return
    }

    let settingsForCheck = settings
    if (chainOrderDirty) {
      settingsForCheck = await saveChainOrder('Порядок связки сохранён, запускаем SSH-проверку...')
      if (!settingsForCheck) return
      setSaving(true)
    }

    const latestFirstProxy = settingsForCheck?.proxies.find((proxy) => proxy.id === firstProxy.id) ?? firstProxy
    await configureChain(latestFirstProxy)
  }

  const configureProxyFromCard = async (proxy: ProxyRecord) => {
    let proxyForCheck = proxy
    if (chainOrderDirty) {
      const updated = await saveChainOrder('Порядок связки сохранён, запускаем SSH-проверку...')
      const latestProxy = updated?.proxies.find((candidate) => candidate.id === proxy.id)
      if (!latestProxy) return
      proxyForCheck = latestProxy
    }

    await configureChain(proxyForCheck)
  }

  const connectProxy = async () => {
    const firstProxyId = chainOrderIds[0]
    const firstProxy = firstProxyId ? proxyById.get(firstProxyId) : undefined
    if (!firstProxy) {
      setMessage('Добавьте серверы, затем соберите связку')
      return
    }

    setSaving(true)
    setMessage('')
    updateRuntimeState({
      activeOperation: 'connect',
      chainResult: undefined,
      chainSetupResult: undefined,
      chainSetupProgress: [],
      connectionResult: undefined
    })
    try {
      let settingsForSetup = settings
      if (chainOrderDirty) {
        settingsForSetup = await saveChainOrder('Порядок связки сохранён, подключаем proxy...')
        if (!settingsForSetup) return
        setSaving(true)
      }

      const latestFirstProxy = settingsForSetup?.proxies.find((proxy) => proxy.id === firstProxy.id) ?? firstProxy
      const result = await getTradeToolsApi().proxies.connectChain({
        proxyId: latestFirstProxy.id,
        localProxyType
      })
      await refreshLocalProxyRuntimeStatus()
      updateRuntimeState({ chainSetupResult: result, connectionResult: result })
      setMessage(result.reusedRuntime ? 'Локальный proxy подключён' : 'Связка настроена, локальный proxy запущен')
    } catch (error) {
      setMessage(userFacingErrorMessage(error, 'Не удалось настроить связку на серверах'))
    } finally {
      setSaving(false)
      onRuntimeStateChange((current) => ({
        ...current,
        activeOperation: current.activeOperation === 'connect' ? undefined : current.activeOperation
      }))
    }
  }

  const refreshVpnBypass = async () => {
    setSaving(true)
    setMessage('')
    updateRuntimeState({
      activeOperation: 'vpn-bypass',
      vpnBypassResult: undefined
    })
    try {
      const status = await getTradeToolsApi().proxies.refreshVpnBypass()
      updateRuntimeState({ vpnBypassStatus: status })
      setMessage(status.message)
    } catch (error) {
      setMessage(userFacingErrorMessage(error, 'Не удалось настроить обход VPN'))
    } finally {
      setSaving(false)
      onRuntimeStateChange((current) => ({
        ...current,
        activeOperation: current.activeOperation === 'vpn-bypass' ? undefined : current.activeOperation
      }))
    }
  }

  const disconnectProxy = async () => {
    setSaving(true)
    setMessage('')
    updateRuntimeState({ activeOperation: 'disconnect' })
    try {
      const updated = await getTradeToolsApi().proxies.disconnect()
      onSaved(updated)
      await refreshLocalProxyRuntimeStatus()
      updateRuntimeState({ connectionResult: undefined, vpnBypassStatus: undefined })
      setMessage('Локальный proxy остановлен, фоновый запуск выключен')
    } catch (error) {
      setMessage(userFacingErrorMessage(error, 'Не удалось отключить proxy'))
    } finally {
      setSaving(false)
      onRuntimeStateChange((current) => ({
        ...current,
        activeOperation: current.activeOperation === 'disconnect' ? undefined : current.activeOperation
      }))
    }
  }

  const deleteProxy = async (proxy: ProxyRecord) => {
    try {
      const updated = await getTradeToolsApi().proxies.delete(proxy.id)
      onSaved(updated)
      if (form.id === proxy.id) setForm(createEmptyForm(updated))
      clearCheckState()
      clearSetupState()
      setMessage('Сервер удалён')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось удалить сервер')
    }
  }

  return (
    <Card id="proxy-section" className="col-span-12 scroll-mt-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Прокси-серверы</h2>
          <p className="mt-1 text-sm text-zinc-500">Сохраняйте серверы, SSH-доступ, оплату и ссылки на хостинг. Серверы можно связать в маршрут.</p>
        </div>
        <Button variant="ghost" onClick={resetForm}><Plus size={17} className="mr-2" />Новый сервер</Button>
      </div>

      <div className={`mt-5 rounded-2xl border p-4 ${connectionSummary.tone === 'success' ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-sky-400/20 bg-sky-500/10'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Server size={17} className={connectionSummary.tone === 'success' ? 'text-emerald-200' : 'text-sky-200'} />
              <span>{connectionSummary.title}</span>
            </div>
            <div className="mt-2 text-xs text-zinc-300">{connectionSummary.bypassLabel}</div>
            <div className="mt-2 text-xs text-zinc-400">Маршрут: {connectionResult?.route || orderedChainProxies.map(proxyName).join(' -> ') || 'добавьте серверы'}</div>
            <div className="mt-1 text-xs text-zinc-400">Терминал: {connectionResult?.entryProxy.type ?? localProxyType} 127.0.0.1:{connectionResult?.entryProxy.port || orderedChainProxies[0]?.localProxyPort || defaultLocalProxyPort}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="min-w-40 text-xs font-medium text-zinc-300">
              Тип подключения
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60"
                value={localProxyType}
                onChange={(event) => setLocalProxyType(event.target.value === 'HTTP' ? 'HTTP' : 'SOCKS5')}
                disabled={busy}
              >
                <option value="SOCKS5">SOCKS5 (рекомендуется)</option>
                <option value="HTTP">HTTP</option>
              </select>
            </label>
            <Button onClick={() => void connectProxy()} disabled={busy || orderedChainProxies.length === 0}>
              <Server size={16} className="mr-2" />
              {runtimeState.activeOperation === 'connect' ? 'Подключаем...' : 'Подключить прокси'}
            </Button>
            {localProxyRunning && (
              <Button variant="ghost" onClick={() => void disconnectProxy()} disabled={busy}>
                <Power size={16} className="mr-2" />
                {runtimeState.activeOperation === 'disconnect' ? 'Отключаем...' : 'Отключить proxy'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void configureOrderedChain()} disabled={busy || orderedChainProxies.length === 0}>
              <Wrench size={16} className="mr-2" />Проверить подключение
            </Button>
            {(vpnBypassStatus?.state === 'needs-uac' || vpnBypassStatus?.state === 'attention') && (
              <Button variant="ghost" onClick={() => void refreshVpnBypass()} disabled={busy}>
                <ShieldAlert size={16} className="mr-2" />Обновить VPN bypass
              </Button>
            )}
          </div>
        </div>
        {message && <div className="mt-3 text-xs text-zinc-300">{message}</div>}
        <details className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-200">Состояние и проверки</summary>
          <div className="mt-3">
            {chainCheckProgress.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-sm font-semibold text-zinc-100">Проверка связки</div>
                <div className="space-y-2 text-xs leading-5">
                  {chainCheckProgress.map((progress, index) => (
                    <div key={`${progress.timestampMs}-${index}`} className="flex gap-2">
                      <span className={progressStatusClass(progress.status)}>{progressStatusLabel(progress.status)}</span>
                      <span className="min-w-0 break-words text-zinc-300">{progress.proxyName ? `${progress.proxyName}: ` : ''}{progress.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {chainSetupProgress.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-sm font-semibold text-zinc-100">Прогресс настройки</div>
                <div className="space-y-2 text-xs leading-5">
                  {chainSetupProgress.map((progress, index) => (
                    <div key={`${progress.timestampMs}-${index}`} className="flex gap-2">
                      <span className={progressStatusClass(progress.status)}>{progressStatusLabel(progress.status)}</span>
                      <span className="min-w-0 break-words text-zinc-300">{progress.proxyName ? `${progress.proxyName}: ` : ''}{progress.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <VpnBypassResultBlock result={vpnBypassResult} />

            {chainSetupResult && (
              <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-xs leading-5 text-zinc-200">
                <div className="text-sm font-semibold text-emerald-100">Локальный proxy запущен</div>
                <div className="mt-2 break-words">Маршрут: {chainSetupResult.route}</div>
                {chainSetupResult.diagnostics.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {chainSetupResult.diagnostics.map((check) => (
                      <div key={check.name} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <div className={check.ok ? 'font-semibold text-emerald-200' : 'font-semibold text-amber-200'}>{check.name}</div>
                        <div className="mt-1 break-words text-zinc-400">{check.message}</div>
                      </div>
                    ))}
                  </div>
                )}
                <NetworkDiagnosticsBlock network={chainSetupResult.network} />
              </div>
            )}

            {chainResult && (
              <div className="mt-3 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-100">
                  <Route size={17} />
                  <span>Проверка подключения</span>
                </div>
                <p className="mt-3 break-words text-xs leading-5 text-zinc-300">Маршрут: {chainResult.route}</p>
                <div className="mt-3 grid gap-2 text-xs text-zinc-300 sm:grid-cols-2">
                  {chainResult.sshChecks.map((check) => (
                    <div key={`${check.host}:${check.port}:${check.login}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <div className="font-semibold text-emerald-200">{check.host}:{check.port}</div>
                      <div className="mt-1 text-zinc-500">{check.message}{check.serverInfo ? `, ${check.serverInfo}` : ''}</div>
                    </div>
                  ))}
                </div>
                <NetworkDiagnosticsBlock network={chainResult.network} />
              </div>
            )}
          </div>
        </details>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          {proxies.length > 0 ? proxies.map((proxy) => {
            const status = paymentBadge(proxy)
            return (
              <div key={proxy.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Server size={17} className="text-violet-200" />
                      <h3 className="m-0 max-w-full truncate text-base font-semibold text-zinc-100">{proxyName(proxy)}</h3>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                      <span className="truncate">IP / домен: {proxy.server || 'не задан'}</span>
                      <span className="truncate">SSH-логин: {proxy.login || 'не задан'}</span>
                      <span>SSH-пароль: {proxy.passwordConfigured ? 'сохранён в keychain' : 'не задан'}</span>
                      <span>Локальный порт: {proxy.localProxyPort || defaultLocalProxyPort}</span>
                      <span>Оплата: {proxy.paymentDueDay ? `${proxy.paymentDueDay} числа каждого месяца` : 'день не задан'}</span>
                      <span className="truncate">Хостинг: {proxy.dashboardUrl || 'ссылка не задана'}</span>
                      <span className="truncate">Следующий: {proxy.nextProxyId ? proxyName(proxyById.get(proxy.nextProxyId) ?? proxy) : 'нет'}</span>
                    </div>
                    <div className="mt-2 flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-300">
                      <Route size={14} className="mt-0.5 shrink-0 text-violet-200" />
                      <span className="min-w-0 break-words">{routeText(proxy, proxyById)}</span>
                    </div>
                    {proxy.notes && <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{proxy.notes}</p>}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" className={compactButtonClass} title="Проверить подключение" onClick={() => void configureProxyFromCard(proxy)} disabled={busy}><Wrench size={15} /></Button>
                    <Button variant="ghost" className={compactButtonClass} title="Редактировать" onClick={() => editProxy(proxy)}><Pencil size={15} /></Button>
                    <Button variant="ghost" className={compactButtonClass} title="Скопировать IP" onClick={() => void copyText(proxy.server, 'IP скопирован')}><Server size={15} className="mr-1.5" />IP</Button>
                    <Button variant="ghost" className={compactButtonClass} title="Скопировать логин" onClick={() => void copyText(proxy.login, 'Логин скопирован')}><UserRound size={15} className="mr-1.5" />Логин</Button>
                    <Button variant="ghost" className={compactButtonClass} title="Скопировать пароль" onClick={() => void copyPassword(proxy)} disabled={!proxy.passwordConfigured}><KeyRound size={15} className="mr-1.5" />Пароль</Button>
                    <Button variant="ghost" className={compactButtonClass} title="Открыть хостинг" onClick={() => void openDashboard(proxy)} disabled={!proxy.dashboardUrl}><ExternalLink size={15} /></Button>
                    <Button variant="ghost" className={compactButtonClass} title="Удалить" onClick={() => void deleteProxy(proxy)}><Trash2 size={15} /></Button>
                  </div>
                </div>
              </div>
            )
          }) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Серверы ещё не добавлены.</div>
          )}
        </div>

        <form className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4" onSubmit={save}>
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock size={18} className="text-violet-200" />
            <h3 className="m-0 text-base font-semibold">{form.id ? 'Редактировать сервер' : 'Добавить сервер'}</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-zinc-500">
              Название
              <input className={inputClass} value={form.name} onChange={(event) => updateForm({ name: event.target.value })} placeholder="Tokyo exit / Hetzner #1" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              IP или домен
              <input className={inputClass} value={form.server} onChange={(event) => updateForm({ server: event.target.value })} placeholder="1.2.3.4" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              SSH-логин
              <input className={inputClass} value={form.login} onChange={(event) => updateForm({ login: event.target.value })} placeholder="root" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              SSH-пароль
              <input className={inputClass} value={form.password} onChange={(event) => updateForm({ password: event.target.value })} type="password" placeholder={editedProxy?.passwordConfigured ? 'Сохранён' : 'Не задан'} />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Локальный порт терминала
              <input className={inputClass} value={form.localProxyPort} onChange={(event) => updateForm({ localProxyPort: event.target.value })} inputMode="numeric" placeholder={String(defaultLocalProxyPort)} />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              День оплаты в месяце
              <input className={inputClass} value={form.paymentDueDay} onChange={(event) => updateForm({ paymentDueDay: event.target.value })} type="number" min="1" max="31" inputMode="numeric" placeholder={currentPaymentDueDay()} />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Сайт хостинга
              <input className={inputClass} value={form.dashboardUrl} onChange={(event) => updateForm({ dashboardUrl: event.target.value })} placeholder="https://..." />
            </label>
            <label className="text-xs font-medium text-zinc-500 sm:col-span-2">
              Заметки
              <textarea className={`${inputClass} min-h-20 resize-none`} value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} placeholder="Назначение, провайдер, тариф, что проверить перед оплатой" />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={resetForm}>Очистить</Button>
            <Button type="submit" disabled={busy}><Save size={17} className="mr-2" />{saving ? 'Сохраняем...' : 'Сохранить сервер'}</Button>
          </div>
        </form>
      </div>

      <div className="mt-5 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-100">
              <Route size={17} />
              <span>Порядок связки</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-300">Добавьте все серверы, затем перетащите их в нужном порядке. Первый сервер будет входом, последний - выходом. Можно использовать кнопки вверх/вниз, если перетаскивание неудобно.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => void saveChainOrder()} disabled={busy || orderedChainProxies.length === 0 || !chainOrderDirty}>
              <Save size={16} className="mr-2" />
              Сохранить порядок
            </Button>
            <Button onClick={() => void configureOrderedChain()} disabled={busy || orderedChainProxies.length === 0}>
              <Wrench size={16} className="mr-2" />
              Проверить подключение
            </Button>
            <Button onClick={() => void connectProxy()} disabled={busy || orderedChainProxies.length === 0}>
              <Server size={16} className="mr-2" />
              Подключить прокси
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {orderedChainProxies.length > 0 ? orderedChainProxies.map((proxy, index) => (
            <div
              key={proxy.id}
              draggable
              onDragStart={(event) => {
                setDraggedProxyId(proxy.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', proxy.id)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = draggedProxyId || event.dataTransfer.getData('text/plain')
                setChainOrderIds((current) => reorderIds(current, sourceId, proxy.id))
                setDraggedProxyId('')
                clearCheckState()
              }}
              onDragEnd={() => setDraggedProxyId('')}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-300/20 bg-sky-400/10 text-sm font-semibold text-sky-100">{index + 1}</div>
              <GripVertical className="shrink-0 cursor-grab text-zinc-500 active:cursor-grabbing" size={18} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-zinc-100">{proxyName(proxy)}</div>
                <div className="mt-0.5 truncate text-xs text-zinc-500">{proxy.server || 'IP не задан'}{index === 0 ? ' · вход' : index === orderedChainProxies.length - 1 ? ' · выход' : ' · промежуточный'}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className={compactButtonClass} title="Выше" onClick={() => {
                  setChainOrderIds((current) => moveIdByOffset(current, proxy.id, -1))
                  clearCheckState()
                }} disabled={index === 0 || busy}><ArrowUp size={15} /></Button>
                <Button variant="ghost" className={compactButtonClass} title="Ниже" onClick={() => {
                  setChainOrderIds((current) => moveIdByOffset(current, proxy.id, 1))
                  clearCheckState()
                }} disabled={index === orderedChainProxies.length - 1 || busy}><ArrowDown size={15} /></Button>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">Добавьте хотя бы один сервер, чтобы собрать связку.</div>
          )}
        </div>

        {orderedChainProxies.length > 0 && (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-300">
            {orderedChainProxies.map((proxy) => proxyName(proxy)).join(' -> ')}
            {chainOrderDirty && <span className="ml-2 text-sky-200">Есть несохранённые изменения порядка</span>}
          </div>
        )}

      </div>

    </Card>
  )
}
