// DSH 会话日志是多帧 zstd：一个文件里堆着很多独立帧，一边写一边追加。
// Node 的 zstdDecompressSync 只解第一帧（1.45MB 的会话只出来 199 字节的会话头），
// 所以按帧魔数切开逐帧解；魔数可能出现在压缩数据内部，解不开就并下一帧重试，
// 实在解不开记为坏帧跳过，不中断整体。

import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export function frameOffsets(buf) {
  const offsets = []
  let cursor = 0
  for (;;) {
    const hit = buf.indexOf(MAGIC, cursor)
    if (hit === -1) break
    offsets.push(hit)
    cursor = hit + MAGIC.length
  }
  return offsets
}

export function decodeMultiFrame(buf) {
  const offsets = frameOffsets(buf)
  if (offsets.length === 0) throw new Error('没有找到任何 zstd 帧魔数')
  if (offsets[0] !== 0) offsets.unshift(0)

  const parts = []
  const skipped = []
  let decoded = 0
  let i = 0

  while (i < offsets.length) {
    const start = offsets[i]
    let ok = false
    for (let last = i; last < offsets.length && last <= i + 4; last++) {
      const tail = last + 1 < offsets.length ? offsets[last + 1] : buf.length
      try {
        const out = zstdDecompressSync(buf.subarray(start, tail))
        parts.push(out)
        decoded += out.length
        i = last + 1
        ok = true
        break
      } catch {
        // 并下一帧再试
      }
    }
    if (!ok) {
      skipped.push({ start, end: start })
      i += 1
    }
  }

  return { text: Buffer.concat(parts).toString('utf8'), frames: offsets.length, decoded, skipped }
}

export function parseEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      events.push(JSON.parse(s))
    } catch {
      // 半行（正在写）或坏数据，跳过
    }
  }
  return events
}
