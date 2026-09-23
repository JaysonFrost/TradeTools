import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FragmentedMp4Reader } from '../../src/main/services/recording/fragmentedMp4'
import { resolveMediaToolPath } from '../../src/main/services/video/mediaBinaries'

describe('fragmented MP4 replay buffer', () => {
  it('turns a real encoded stream into independently decodable fragments', async () => {
    const ffmpeg = resolveMediaToolPath('ffmpeg')
    const directory = await mkdtemp(join(tmpdir(), 'tradetools-mp4-fragments-'))
    const reader = new FragmentedMp4Reader()
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-g', '10',
      '-bf', '0', '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-f', 'mp4', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const fragments: ReturnType<FragmentedMp4Reader['push']> = []
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    try {
      for await (const chunk of child.stdout) {
        // stdout is allowed to split headers and box payloads at arbitrary offsets.
        for (let offset = 0; offset < chunk.length; offset += 137) {
          fragments.push(...reader.push(chunk.subarray(offset, offset + 137)))
        }
      }
      const exitCode = await new Promise<number | null>((resolve) => child.once('close', resolve))
      expect(exitCode, stderr).toBe(0)
      expect(fragments.length).toBeGreaterThanOrEqual(2)
      for (const [index, fragment] of fragments.entries()) {
        const path = join(directory, `${index}.mp4`)
        await writeFile(path, fragment.data)
        const probe = spawn(resolveMediaToolPath('ffprobe'), [
          '-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', path
        ], { stdio: ['ignore', 'pipe', 'pipe'] })
        let streams = ''
        probe.stdout.on('data', (chunk) => { streams += String(chunk) })
        const probeCode = await new Promise<number | null>((resolve) => probe.once('close', resolve))
        expect(probeCode).toBe(0)
        const mediaStreams = JSON.parse(streams).streams as Array<{ codec_type: string, start_time: string }>
        expect(mediaStreams.map((stream) => stream.codec_type)).toEqual(expect.arrayContaining(['video', 'audio']))
        for (const stream of mediaStreams) expect(Math.abs(Number(stream.start_time))).toBeLessThan(0.05)
        const result = spawn(ffmpeg, ['-v', 'error', '-i', path, '-f', 'null', '-'], { stdio: 'ignore' })
        const code = await new Promise<number | null>((resolve) => result.once('close', resolve))
        expect(code).toBe(0)
        expect((await readFile(path)).length).toBeGreaterThan(100)
        expect(fragment.endSeconds).toBeGreaterThan(fragment.startSeconds)
      }
      expect(fragments.at(-1)!.endSeconds).toBeCloseTo(3, 1)
    } finally {
      child.kill()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
