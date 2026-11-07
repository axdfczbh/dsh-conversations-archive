// 清理图片/表情：把指定时间点（含）之前的图片文件删掉，记录本身保持原样。
// 记录里的 media.file 会指向一个不存在的文件，读的时候按「方案一」展示即可。

import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function purgeMedia(records, { until, archiveDir, logFile }) {
  const cutoff = Number(until)
  if (!Number.isFinite(cutoff)) throw new Error('时间点无效')

  let files = 0
  let bytes = 0
  const touched = []
  for (const r of records) {
    const rel = r?.media?.file
    if (!rel) continue
    if ((r.time ?? 0) > cutoff) continue
    const target = join(archiveDir, rel)
    if (!existsSync(target)) continue
    try {
      const size = statSync(target).size
      unlinkSync(target)
      files += 1
      bytes += size
      touched.push(rel)
    } catch {
      // 单个文件删不掉不影响其它
    }
  }

  const summary = {
    at: new Date().toISOString(),
    until: new Date(cutoff).toISOString(),
    cut: cutoff,
    files,
    bytes,
  }
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    appendFileSync(logFile, JSON.stringify(summary) + '\n', 'utf8')
  } catch {
    // 日志写不进去不算失败
  }
  return summary
}

/** 记录里的图片还在吗（不在就按方案一展示）。 */
export function mediaExists(record, archiveDir) {
  const rel = record?.media?.file
  if (!rel) return false
  return existsSync(join(archiveDir, rel))
}
