import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'

type LockOwner = {
  pid: number
  token: string
}

type LockOwnerRead =
  | { kind: 'owner', owner: LockOwner }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'error' }

export type AppDataInstanceLock = {
  acquired: boolean
  release: () => void
}

const notAcquired = (): AppDataInstanceLock => ({ acquired: false, release: () => undefined })

const errorCode = (error: unknown): string => (
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
)

const defaultProcessIsAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === 'EPERM'
  }
}

const readOwner = (lockPath: string): LockOwnerRead => {
  let contents: string
  try {
    contents = readFileSync(lockPath, 'utf8')
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? { kind: 'missing' } : { kind: 'error' }
  }

  try {
    const parsed = JSON.parse(contents) as Partial<LockOwner>
    return Number.isInteger(parsed.pid)
      && (parsed.pid ?? 0) > 0
      && typeof parsed.token === 'string'
      && parsed.token.length > 0
      ? { kind: 'owner', owner: { pid: parsed.pid!, token: parsed.token } }
      : { kind: 'invalid' }
  } catch {
    return { kind: 'invalid' }
  }
}

const sameOwner = (left: LockOwner, right: LockOwner): boolean => (
  left.pid === right.pid && left.token === right.token
)

const removeOwnedLock = (lockPath: string, token: string): boolean => {
  const owner = readOwner(lockPath)
  if (owner.kind !== 'owner' || owner.owner.token !== token) return false

  try {
    rmSync(lockPath)
    return true
  } catch {
    return false
  }
}

const writeCompleteCandidate = (candidatePath: string, owner: LockOwner): boolean => {
  let descriptor: number | undefined
  let complete = false

  try {
    descriptor = openSync(candidatePath, 'wx', 0o600)
    const contents = Buffer.from(JSON.stringify(owner), 'utf8')
    let offset = 0
    while (offset < contents.length) {
      const written = writeSync(descriptor, contents, offset, contents.length - offset)
      if (written <= 0) return false
      offset += written
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    complete = true
    return true
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        complete = false
      }
    }
    if (!complete) {
      try {
        rmSync(candidatePath, { force: true })
      } catch {
        // A private candidate cannot grant ownership and is safe to leave behind.
      }
    }
  }
}

const safeProcessIsAlive = (
  processIsAlive: (pid: number) => boolean,
  pid: number
): boolean | undefined => {
  try {
    return processIsAlive(pid)
  } catch {
    return undefined
  }
}

const isConfirmedDeadOwner = (
  lockPath: string,
  observedOwner: LockOwner,
  processIsAlive: (pid: number) => boolean
): boolean => {
  if (safeProcessIsAlive(processIsAlive, observedOwner.pid) !== false) return false

  const confirmed = readOwner(lockPath)
  if (confirmed.kind !== 'owner' || !sameOwner(observedOwner, confirmed.owner)) return false

  return safeProcessIsAlive(processIsAlive, confirmed.owner.pid) === false
}

const restoreMovedRecoveryLock = (tombstonePath: string, recoveryPath: string): void => {
  try {
    linkSync(tombstonePath, recoveryPath)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') return
  }

  try {
    rmSync(tombstonePath, { force: true })
  } catch {
    // The tombstone is private and is never treated as the public recovery lock.
  }
}

const acquireRecoveryLock = (
  candidatePath: string,
  recoveryPath: string,
  tombstonePath: string,
  processIsAlive: (pid: number) => boolean
): boolean => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      linkSync(candidatePath, recoveryPath)
      return true
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') return false
    }

    const observed = readOwner(recoveryPath)
    if (observed.kind === 'missing') continue
    if (observed.kind !== 'owner') return false
    if (!isConfirmedDeadOwner(recoveryPath, observed.owner, processIsAlive)) return false

    try {
      renameSync(recoveryPath, tombstonePath)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue
      return false
    }

    const moved = readOwner(tombstonePath)
    if (
      moved.kind !== 'owner'
      || !sameOwner(observed.owner, moved.owner)
      || !isConfirmedDeadOwner(tombstonePath, moved.owner, processIsAlive)
    ) {
      restoreMovedRecoveryLock(tombstonePath, recoveryPath)
      return false
    }

    try {
      rmSync(tombstonePath)
    } catch {
      return false
    }
  }

  return false
}

const recoverMainLock = (
  lockPath: string,
  recoveryPath: string,
  recoveryToken: string,
  processIsAlive: (pid: number) => boolean
): boolean => {
  const observed = readOwner(lockPath)
  if (observed.kind === 'missing') return true
  if (observed.kind !== 'owner') return false
  if (!isConfirmedDeadOwner(lockPath, observed.owner, processIsAlive)) return false

  const confirmed = readOwner(lockPath)
  if (confirmed.kind !== 'owner' || !sameOwner(observed.owner, confirmed.owner)) return false
  if (safeProcessIsAlive(processIsAlive, confirmed.owner.pid) !== false) return false

  const recoveryOwner = readOwner(recoveryPath)
  if (recoveryOwner.kind !== 'owner' || recoveryOwner.owner.token !== recoveryToken) return false

  try {
    rmSync(lockPath)
    return true
  } catch (error) {
    return errorCode(error) === 'ENOENT'
  }
}

export const acquireAppDataInstanceLock = (
  appDataDir: string,
  options: { pid?: number, processIsAlive?: (pid: number) => boolean } = {}
): AppDataInstanceLock => {
  const pid = options.pid ?? process.pid
  if (!Number.isInteger(pid) || pid <= 0) return notAcquired()

  const processIsAlive = options.processIsAlive ?? defaultProcessIsAlive
  const token = randomUUID()
  const owner = { pid, token } satisfies LockOwner
  const lockPath = join(appDataDir, '.tradetools-instance.lock')
  const recoveryPath = join(appDataDir, '.tradetools-instance.lock.recovery')
  const candidatePath = join(appDataDir, `.tradetools-instance.lock.candidate-${pid}-${token}`)
  const tombstonePath = join(appDataDir, `.tradetools-instance.lock.recovery-stale-${pid}-${token}`)

  try {
    mkdirSync(appDataDir, { recursive: true })
  } catch {
    return notAcquired()
  }

  if (!writeCompleteCandidate(candidatePath, owner)) return notAcquired()

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const recoveryState = readOwner(recoveryPath)
      if (recoveryState.kind === 'invalid' || recoveryState.kind === 'error') return notAcquired()

      if (recoveryState.kind === 'owner') {
        if (!acquireRecoveryLock(candidatePath, recoveryPath, tombstonePath, processIsAlive)) {
          return notAcquired()
        }

        const recovered = recoverMainLock(lockPath, recoveryPath, token, processIsAlive)
        const releasedRecovery = removeOwnedLock(recoveryPath, token)
        if (!recovered || !releasedRecovery) return notAcquired()
        continue
      }

      try {
        linkSync(candidatePath, lockPath)
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') return notAcquired()

        if (!acquireRecoveryLock(candidatePath, recoveryPath, tombstonePath, processIsAlive)) {
          return notAcquired()
        }

        const recovered = recoverMainLock(lockPath, recoveryPath, token, processIsAlive)
        const releasedRecovery = removeOwnedLock(recoveryPath, token)
        if (!recovered || !releasedRecovery) return notAcquired()
        continue
      }

      if (readOwner(recoveryPath).kind !== 'missing') {
        removeOwnedLock(lockPath, token)
        return notAcquired()
      }

      return {
        acquired: true,
        release: () => {
          removeOwnedLock(lockPath, token)
        }
      }
    }

    return notAcquired()
  } finally {
    try {
      rmSync(candidatePath, { force: true })
    } catch {
      // The unique candidate is not the public lock and cannot grant ownership.
    }
    try {
      rmSync(tombstonePath, { force: true })
    } catch {
      // The unique tombstone is not consulted by other instances.
    }
  }
}
