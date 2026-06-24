import { execFile } from 'node:child_process'
import type { RecordingVideoEncoder } from '../settings/settings'

type GpuVideoEncoderVendor = 'nvidia' | 'amd' | 'intel'

export type VideoEncoderOption = {
  id: RecordingVideoEncoder
  label: string
  kind: 'gpu' | 'cpu'
}

export type WindowsVideoControllerInput = {
  Name?: unknown
  AdapterCompatibility?: unknown
  PNPDeviceID?: unknown
}

const cpuVideoEncoderOption: VideoEncoderOption = { id: 'cpu', label: 'Процессор', kind: 'cpu' }

const normalizeString = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const detectGpuVendor = (value: string): GpuVideoEncoderVendor | undefined => {
  if (/\bnvidia\b/i.test(value)) return 'nvidia'
  if (/\bintel\b/i.test(value)) return 'intel'
  if (/\bamd\b|advanced micro devices|radeon/i.test(value)) return 'amd'
  return undefined
}

export const buildVideoEncoderOptionsFromWindowsControllers = (controllers: WindowsVideoControllerInput[]): VideoEncoderOption[] => {
  const vendorIndexes = new Map<GpuVideoEncoderVendor, number>()
  const gpuOptions = controllers.flatMap((controller) => {
    const label = normalizeString(controller.Name)
    const vendor = detectGpuVendor(`${label} ${normalizeString(controller.AdapterCompatibility)} ${normalizeString(controller.PNPDeviceID)}`)
    if (!label || !vendor) return []

    const index = vendorIndexes.get(vendor) ?? 0
    vendorIndexes.set(vendor, index + 1)
    return [{ id: `gpu:${vendor}:${index}` as RecordingVideoEncoder, label, kind: 'gpu' as const }]
  })

  return [...gpuOptions, cpuVideoEncoderOption]
}

const readWindowsVideoControllers = async (): Promise<WindowsVideoControllerInput[]> => {
  const command = [
    'Get-CimInstance Win32_VideoController',
    'Select-Object Name,AdapterCompatibility,PNPDeviceID',
    'ConvertTo-Json -Compress'
  ].join(' | ')

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      timeout: 5_000,
      windowsHide: true
    }, (error, output) => {
      if (error) {
        reject(error)
        return
      }
      resolve(output)
    })
  })

  const parsed = JSON.parse(stdout.trim() || '[]') as WindowsVideoControllerInput | WindowsVideoControllerInput[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

export const listAvailableVideoEncoders = async (platform: NodeJS.Platform = process.platform): Promise<VideoEncoderOption[]> => {
  if (platform === 'win32') {
    try {
      return buildVideoEncoderOptionsFromWindowsControllers(await readWindowsVideoControllers())
    } catch {
      return [{ id: 'gpu', label: 'Видеокарта (авто)', kind: 'gpu' }, cpuVideoEncoderOption]
    }
  }

  if (platform === 'darwin') return [{ id: 'gpu', label: 'Apple VideoToolbox', kind: 'gpu' }, cpuVideoEncoderOption]

  return [cpuVideoEncoderOption]
}
