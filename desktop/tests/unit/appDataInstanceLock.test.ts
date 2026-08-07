import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireAppDataInstanceLock } from '../../src/main/services/appDataInstanceLock'

describe('appDataInstanceLock', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('publishes a complete lock and allows only one owner', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-instance-lock-'))
    tempDirs.push(appDataDir)
    const lockPath = join(appDataDir, '.tradetools-instance.lock')
    const first = acquireAppDataInstanceLock(appDataDir, { pid: 101, processIsAlive: (pid) => pid === 101 })

    expect(first.acquired).toBe(true)
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ pid: 101 })

    const second = acquireAppDataInstanceLock(appDataDir, { pid: 202, processIsAlive: (pid) => pid === 101 })
    expect(second.acquired).toBe(false)

    first.release()
    expect(acquireAppDataInstanceLock(appDataDir, { pid: 202, processIsAlive: () => false }).acquired).toBe(true)
  })

  it('recovers a valid stale lock left by a crashed process', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-stale-instance-lock-'))
    tempDirs.push(appDataDir)
    await writeFile(join(appDataDir, '.tradetools-instance.lock'), JSON.stringify({ pid: 999999, token: 'stale' }))

    const lock = acquireAppDataInstanceLock(appDataDir, { pid: 303, processIsAlive: () => false })

    expect(lock.acquired).toBe(true)
    lock.release()
  })

  it('recovers a stale recovery owner left after a crash', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-stale-recovery-lock-'))
    tempDirs.push(appDataDir)
    await writeFile(
      join(appDataDir, '.tradetools-instance.lock'),
      JSON.stringify({ pid: 1101, token: 'stale-main' })
    )
    await writeFile(
      join(appDataDir, '.tradetools-instance.lock.recovery'),
      JSON.stringify({ pid: 1101, token: 'stale-recovery' })
    )

    const lock = acquireAppDataInstanceLock(appDataDir, { pid: 1102, processIsAlive: () => false })

    expect(lock.acquired).toBe(true)
    expect(JSON.parse(await readFile(join(appDataDir, '.tradetools-instance.lock'), 'utf8'))).toMatchObject({
      pid: 1102
    })
    await expect(readFile(join(appDataDir, '.tradetools-instance.lock.recovery'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    lock.release()
  })

  it('recovers stale recovery state when the main lock was already removed', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-stale-recovery-only-'))
    tempDirs.push(appDataDir)
    await writeFile(
      join(appDataDir, '.tradetools-instance.lock.recovery'),
      JSON.stringify({ pid: 1201, token: 'stale-recovery' })
    )

    const lock = acquireAppDataInstanceLock(appDataDir, { pid: 1202, processIsAlive: () => false })

    expect(lock.acquired).toBe(true)
    lock.release()
  })

  it('keeps a live recovery owner and fails closed', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-live-recovery-lock-'))
    tempDirs.push(appDataDir)
    const recoveryPath = join(appDataDir, '.tradetools-instance.lock.recovery')
    const contents = JSON.stringify({ pid: 1301, token: 'live-recovery' })
    await writeFile(recoveryPath, contents)

    const lock = acquireAppDataInstanceLock(appDataDir, {
      pid: 1302,
      processIsAlive: (pid) => pid === 1301
    })

    expect(lock.acquired).toBe(false)
    expect(await readFile(recoveryPath, 'utf8')).toBe(contents)
  })

  it.each(['', '{broken recovery', JSON.stringify({ pid: 1401 })])(
    'fails closed without replacing an invalid recovery owner: %j',
    async (contents) => {
      const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-invalid-recovery-lock-'))
      tempDirs.push(appDataDir)
      const recoveryPath = join(appDataDir, '.tradetools-instance.lock.recovery')
      await writeFile(recoveryPath, contents)

      const lock = acquireAppDataInstanceLock(appDataDir, { pid: 1402, processIsAlive: () => false })

      expect(lock.acquired).toBe(false)
      expect(await readFile(recoveryPath, 'utf8')).toBe(contents)
    }
  )

  it('fails closed on an unexpected recovery lock read error', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-recovery-read-error-'))
    tempDirs.push(appDataDir)
    const recoveryPath = join(appDataDir, '.tradetools-instance.lock.recovery')
    await mkdir(recoveryPath)

    const lock = acquireAppDataInstanceLock(appDataDir, { pid: 1451, processIsAlive: () => false })

    expect(lock.acquired).toBe(false)
    expect((await stat(recoveryPath)).isDirectory()).toBe(true)
  })

  it('does not remove a replacement recovery owner during stale cleanup', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-replaced-recovery-lock-'))
    tempDirs.push(appDataDir)
    const recoveryPath = join(appDataDir, '.tradetools-instance.lock.recovery')
    await writeFile(recoveryPath, JSON.stringify({ pid: 1471, token: 'stale-recovery' }))
    let replaced = false

    const lock = acquireAppDataInstanceLock(appDataDir, {
      pid: 1472,
      processIsAlive: (pid) => {
        if (pid === 1471 && !replaced) {
          replaced = true
          writeFileSync(recoveryPath, JSON.stringify({ pid: 1473, token: 'live-recovery' }))
          return false
        }
        return pid === 1473
      }
    })

    expect(lock.acquired).toBe(false)
    expect(JSON.parse(await readFile(recoveryPath, 'utf8'))).toEqual({ pid: 1473, token: 'live-recovery' })
  })

  it('allows only one recovery contender to replace a stale main lock', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-concurrent-recovery-lock-'))
    tempDirs.push(appDataDir)
    await writeFile(
      join(appDataDir, '.tradetools-instance.lock'),
      JSON.stringify({ pid: 1501, token: 'stale-main' })
    )
    let competingLock: ReturnType<typeof acquireAppDataInstanceLock> | undefined

    const winningLock = acquireAppDataInstanceLock(appDataDir, {
      pid: 1502,
      processIsAlive: (pid) => {
        if (pid === 1501 && !competingLock) {
          competingLock = acquireAppDataInstanceLock(appDataDir, {
            pid: 1503,
            processIsAlive: (ownerPid) => ownerPid === 1502
          })
        }
        return pid === 1502
      }
    })

    expect(winningLock.acquired).toBe(true)
    expect(competingLock?.acquired).toBe(false)
    expect(JSON.parse(await readFile(join(appDataDir, '.tradetools-instance.lock'), 'utf8'))).toMatchObject({
      pid: 1502
    })
    winningLock.release()
  })

  it.each(['', '{broken json', JSON.stringify({ pid: 404 })])(
    'fails closed without replacing an invalid existing lock: %j',
    async (contents) => {
      const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-invalid-instance-lock-'))
      tempDirs.push(appDataDir)
      const lockPath = join(appDataDir, '.tradetools-instance.lock')
      await writeFile(lockPath, contents)

      const lock = acquireAppDataInstanceLock(appDataDir, { pid: 404, processIsAlive: () => false })

      expect(lock.acquired).toBe(false)
      expect(await readFile(lockPath, 'utf8')).toBe(contents)
    }
  )

  it('fails closed when process liveness cannot be determined', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-liveness-instance-lock-'))
    tempDirs.push(appDataDir)
    const lockPath = join(appDataDir, '.tradetools-instance.lock')
    const contents = JSON.stringify({ pid: 505, token: 'unknown-owner' })
    await writeFile(lockPath, contents)

    const lock = acquireAppDataInstanceLock(appDataDir, {
      pid: 606,
      processIsAlive: () => {
        throw new Error('liveness probe failed')
      }
    })

    expect(lock.acquired).toBe(false)
    expect(await readFile(lockPath, 'utf8')).toBe(contents)
  })

  it('does not remove a replacement owner that appears during stale recovery', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'tradetools-replaced-instance-lock-'))
    tempDirs.push(appDataDir)
    const lockPath = join(appDataDir, '.tradetools-instance.lock')
    await writeFile(lockPath, JSON.stringify({ pid: 707, token: 'stale-owner' }))
    let replaced = false

    const lock = acquireAppDataInstanceLock(appDataDir, {
      pid: 808,
      processIsAlive: (pid) => {
        if (pid === 707 && !replaced) {
          replaced = true
          writeFileSync(lockPath, JSON.stringify({ pid: 909, token: 'live-replacement' }))
          return false
        }
        return pid === 909
      }
    })

    expect(lock.acquired).toBe(false)
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual({ pid: 909, token: 'live-replacement' })
  })

  it('fails closed when the app data path cannot be initialized', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'tradetools-invalid-app-data-'))
    tempDirs.push(parentDir)
    const appDataFile = join(parentDir, 'not-a-directory')
    await writeFile(appDataFile, 'occupied')

    expect(acquireAppDataInstanceLock(appDataFile, { pid: 1001 }).acquired).toBe(false)
  })
})
