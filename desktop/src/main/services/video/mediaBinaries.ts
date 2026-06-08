import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

type MediaToolName = 'ffmpeg' | 'ffprobe'

type StaticFfprobePackage = {
  path?: unknown
}

const require = createRequire(import.meta.url)

const executableName = (tool: MediaToolName): string => process.platform === 'win32' ? `${tool}.exe` : tool

const firstString = (...values: unknown[]): string | undefined => {
  const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim())
  return typeof value === 'string' ? value : undefined
}

const toUnpackedAsarPath = (path: string): string => path.includes('app.asar')
  ? path.replace('app.asar', 'app.asar.unpacked')
  : path

const canAccessFile = (path: string): boolean => {
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

const requireOptional = (moduleName: string): unknown => {
  try {
    return require(moduleName) as unknown
  } catch {
    return undefined
  }
}

const staticPackagePath = (tool: MediaToolName): string | undefined => {
  if (tool === 'ffmpeg') return firstString(requireOptional('ffmpeg-static'))

  const ffprobePackage = requireOptional('ffprobe-static') as StaticFfprobePackage | undefined
  return firstString(ffprobePackage?.path)
}

const bundledResourceCandidates = (tool: MediaToolName): string[] => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) return []

  const name = executableName(tool)
  return [
    join(resourcesPath, 'bin', name),
    join(resourcesPath, tool, name),
    join(resourcesPath, name),
    join(dirname(process.execPath), name)
  ]
}

export const resolveMediaToolPath = (tool: MediaToolName): string => {
  const envPath = firstString(
    process.env[`TRADETOOLS_${tool.toUpperCase()}_PATH`],
    process.env[`${tool.toUpperCase()}_PATH`]
  )
  if (envPath) return envPath

  const staticPath = staticPackagePath(tool)
  if (staticPath) {
    const unpackedPath = toUnpackedAsarPath(staticPath)
    if (canAccessFile(unpackedPath)) return unpackedPath
    if (canAccessFile(staticPath)) return staticPath
  }

  const resourcePath = bundledResourceCandidates(tool).find(canAccessFile)
  return resourcePath ?? executableName(tool)
}

export const createMissingMediaToolError = (tool: MediaToolName): Error => new Error(
  `${tool} не найден. Перезапустите приложение после установки зависимостей или установите FFmpeg и добавьте ${tool} в PATH. ` +
  `Также можно указать путь вручную через переменную TRADETOOLS_${tool.toUpperCase()}_PATH.`
)

export const isMissingMediaToolError = (error: unknown): boolean => (
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code === 'ENOENT'
)
