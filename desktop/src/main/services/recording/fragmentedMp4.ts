// Reads complete top-level ISO BMFF boxes without copying partial stdout chunks.
const maxBoxBytes = 128 * 1024 * 1024

const boxes = (data: Buffer, start = 0, end = data.length): Array<{ type: string, start: number, end: number, header: number }> => {
  const result: Array<{ type: string, start: number, end: number, header: number }> = []
  for (let offset = start; offset + 8 <= end;) {
    let length = data.readUInt32BE(offset)
    const header = length === 1 ? 16 : 8
    if (length === 1 && offset + 16 <= end) length = Number(data.readBigUInt64BE(offset + 8))
    if (!Number.isSafeInteger(length) || length < header || offset + length > end) break
    result.push({ type: data.toString('ascii', offset + 4, offset + 8), start: offset, end: offset + length, header })
    offset += length
  }
  return result
}

const nested = (data: Buffer, path: string[]): { start: number, end: number, header: number } | undefined => {
  let current = { start: 0, end: data.length, header: 0 }
  for (const name of path) {
    const child = boxes(data, current.start + current.header, current.end).find((box) => box.type === name)
    if (!child) return undefined
    current = child
  }
  return current
}

const rebaseFragmentTrackTimestamps = (moof: Buffer): void => {
  const moofHeader = moof.readUInt32BE(0) === 1 ? 16 : 8
  const trafBoxes = boxes(moof, moofHeader).filter((box) => box.type === 'traf')
  for (const traf of trafBoxes) {
    const tfdt = boxes(moof, traf.start + traf.header, traf.end).find((box) => box.type === 'tfdt')
    if (!tfdt) continue
    const offset = tfdt.start + tfdt.header
    if (moof[offset] === 1) moof.writeBigUInt64BE(0n, offset + 4)
    else moof.writeUInt32BE(0, offset + 4)
  }
}

export type Mp4Fragment = { data: Buffer, startSeconds: number, endSeconds: number }

export class FragmentedMp4Reader {
  private chunks: Buffer[] = []
  private bytes = 0
  private init: Buffer[] = []
  private moof?: Buffer
  private timescale = 0
  private firstDecodeTime?: number

  push(data: Buffer): Mp4Fragment[] {
    if (data.length) {
      this.chunks.push(data)
      this.bytes += data.length
    }
    const fragments: Mp4Fragment[] = []
    while (this.bytes >= 8) {
      const header = this.peek(Math.min(this.bytes, 16))
      const size = header.readUInt32BE(0)
      const headerLength = size === 1 ? 16 : 8
      if (this.bytes < headerLength) break
      const length = size === 1 ? Number(header.readBigUInt64BE(8)) : size
      if (!Number.isSafeInteger(length) || length < headerLength || length > maxBoxBytes) {
        throw new Error('Некорректный размер фрагмента MP4')
      }
      if (this.bytes < length) break
      const box = this.take(length)
      const type = box.toString('ascii', 4, 8)
      if (type === 'ftyp' || type === 'moov') {
        this.init.push(box)
        if (type === 'moov') {
          const mdhd = nested(box, ['moov', 'trak', 'mdia', 'mdhd'])
          if (!mdhd) throw new Error('В MP4 отсутствует шкала времени')
          const offset = mdhd.start + mdhd.header
          this.timescale = box.readUInt32BE(offset + (box[offset] === 1 ? 20 : 12))
          if (!this.timescale) throw new Error('Некорректная шкала времени MP4')
        }
      } else if (type === 'moof') {
        this.moof = box
      } else if (type === 'mdat' && this.moof && this.timescale && this.init.length >= 2) {
        const moof = this.moof
        this.moof = undefined
        const tfdt = nested(moof, ['moof', 'traf', 'tfdt'])
        const tfhd = nested(moof, ['moof', 'traf', 'tfhd'])
        const trun = nested(moof, ['moof', 'traf', 'trun'])
        if (!tfdt || !tfhd || !trun) throw new Error('Неполный MP4-фрагмент')
        const tfdtOffset = tfdt.start + tfdt.header
        const decodeTime = Number(moof[tfdtOffset] === 1
          ? moof.readBigUInt64BE(tfdtOffset + 4)
          : moof.readUInt32BE(tfdtOffset + 4))
        this.firstDecodeTime ??= decodeTime
        // Each saved key-frame group has its own time origin across video and audio.
        rebaseFragmentTrackTimestamps(moof)
        const tfhdOffset = tfhd.start + tfhd.header
        const tfhdFlags = moof.readUInt32BE(tfhdOffset) & 0xffffff
        let defaultDuration = 0
        let cursor = tfhdOffset + 8
        if (tfhdFlags & 0x000001) cursor += 8
        if (tfhdFlags & 0x000002) cursor += 4
        if (tfhdFlags & 0x000008) defaultDuration = moof.readUInt32BE(cursor)
        const trunOffset = trun.start + trun.header
        const trunFlags = moof.readUInt32BE(trunOffset) & 0xffffff
        const samples = moof.readUInt32BE(trunOffset + 4)
        cursor = trunOffset + 8 + ((trunFlags & 0x000001) ? 4 : 0) + ((trunFlags & 0x000004) ? 4 : 0)
        let duration = 0
        for (let index = 0; index < samples; index++) {
          duration += (trunFlags & 0x000100) ? moof.readUInt32BE(cursor) : defaultDuration
          cursor += ((trunFlags & 0x000100) ? 4 : 0) +
            ((trunFlags & 0x000200) ? 4 : 0) +
            ((trunFlags & 0x000400) ? 4 : 0) +
            ((trunFlags & 0x000800) ? 4 : 0)
          if (cursor > trun.end) throw new Error('Некорректная таблица MP4-фрагмента')
        }
        if (!duration || samples > 100_000) throw new Error('Некорректная длительность MP4-фрагмента')
        fragments.push({
          data: Buffer.concat([...this.init, moof, box]),
          startSeconds: (decodeTime - this.firstDecodeTime) / this.timescale,
          endSeconds: (decodeTime - this.firstDecodeTime + duration) / this.timescale
        })
      }
    }
    return fragments
  }

  private peek(length: number): Buffer {
    if (this.chunks[0]!.length >= length) return this.chunks[0]!.subarray(0, length)
    const result = Buffer.allocUnsafe(length)
    let offset = 0
    for (const chunk of this.chunks) {
      const count = Math.min(chunk.length, length - offset)
      chunk.copy(result, offset, 0, count)
      offset += count
      if (offset === length) break
    }
    return result
  }

  private take(length: number): Buffer {
    const result = this.peek(length)
    let remaining = length
    while (remaining > 0) {
      const chunk = this.chunks[0]!
      if (remaining < chunk.length) this.chunks[0] = chunk.subarray(remaining)
      else this.chunks.shift()
      remaining -= Math.min(remaining, chunk.length)
    }
    this.bytes -= length
    return result
  }
}
