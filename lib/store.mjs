// 档案存储：只追加、不覆盖、不删除。
// 去重靠 `会话id:事件序号`，所以实时抓取和历史回补重复跑也只会有一份。

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const cache = new Map() // file -> { size, mtimeMs, records }

export function ensureArchiveFile(file) {
  mkdirSync(dirname(file), { recursive: true })
  if (!existsSync(file)) appendFileSync(file, '', 'utf8')
  return file
}

export function readRecords(file) {
  if (!existsSync(file)) return []
  const st = statSync(file)
  const hit = cache.get(file)
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.records

  const records = []
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      records.push(JSON.parse(s))
    } catch {
      // 半行（进程被杀）跳过，不中断
    }
  }
  cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, records })
  return records
}

export function loadIds(file) {
  const ids = new Set()
  for (const r of readRecords(file)) if (r?.id) ids.add(r.id)
  return ids
}

/** 追加记录，跳过已存在的 id。返回真正写入的条数。 */
export function appendRecords(file, records, knownIds) {
  ensureArchiveFile(file)
  const ids = knownIds ?? loadIds(file)
  const fresh = []
  for (const r of records) {
    if (!r?.id || ids.has(r.id)) continue
    ids.add(r.id)
    fresh.push(r)
  }
  if (fresh.length === 0) return 0
  appendFileSync(file, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  cache.delete(file) // 让下一次读取重新加载
  return fresh.length
}
