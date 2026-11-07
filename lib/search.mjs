// 检索：关键词 + 时间范围，打分排序。
// 中文不切词，直接按子串匹配——查一句话里的短语正好命中。

import { readRecords } from './store.mjs'

const DAY = 24 * 60 * 60 * 1000

export function parseBound(value, endOfDay = false) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value
  const s = String(value).trim()
  // 纯日期：按本地时区当天 00:00 / 23:59:59
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0).getTime()
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

export function searchRecords(records, { query, since, until, limit = 10, source }) {
  const q = String(query ?? '').trim()
  if (!q) return []
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const from = parseBound(since)
  const to = parseBound(until, true)
  const max = Math.max(1, Math.min(50, Number(limit) || 10))

  const scored = []
  for (const r of records) {
    const text = String(r.text ?? '')
    if (source && r.source !== source) continue
    if (from !== null && (r.time ?? 0) < from) continue
    if (to !== null && (r.time ?? 0) > to) continue

    const lower = text.toLowerCase()
    let score = 0
    let hitAll = true
    for (const term of terms) {
      const n = countOccurrences(lower, term)
      if (n === 0) {
        hitAll = false
        break
      }
      score += n
    }
    if (!hitAll) continue
    if (terms.length > 1 && lower.includes(q.toLowerCase())) score += 10
    scored.push({ r, score })
  }

  scored.sort((a, b) => b.score - a.score || (b.r.time ?? 0) - (a.r.time ?? 0))

  // 同一句话在短时间内可能被记两遍（B站 先 --dry 再 --go、QQ 失败重发等）。
  // 档案本身照原样留着，只在检索结果里合并显示。
  const kept = []
  for (const item of scored) {
    const twin = kept.find(
      (k) =>
        k.r.source === item.r.source &&
        k.r.role === item.r.role &&
        normalize(k.r.text) === normalize(item.r.text) &&
        Math.abs((k.r.time ?? 0) - (item.r.time ?? 0)) < 30 * 60 * 1000,
    )
    if (!twin) kept.push(item)
    if (kept.length >= max) break
  }
  return kept.map(({ r, score }) => ({ ...r, score }))
}

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n += 1
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

export function formatHit(r, { maxChars = 300, windowTitle } = {}) {
  const when = new Date(r.time ?? 0)
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`
  const who = r.role === 'user' ? '你' : '我'
  const text = String(r.text ?? '').replace(/\s+/g, ' ')
  const body = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
  const where = windowTitle ? ` · 窗口「${windowTitle}」` : ''
  return `${stamp} · ${r.source}${where} · ${who} · ${r.sessionId}#${r.seq}\n${body}`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function stats(records) {
  const bySource = {}
  let last = null
  for (const r of records) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1
    if (last === null || (r.time ?? 0) > last) last = r.time ?? 0
  }
  return {
    total: records.length,
    bySource,
    lastWrite: last === null ? null : new Date(last).toISOString(),
    days: spanDays(records, DAY),
  }
}

function spanDays(records, _day) {
  if (records.length === 0) return 0
  let min = Infinity
  let max = -Infinity
  for (const r of records) {
    const t = r.time ?? 0
    if (t < min) min = t
    if (t > max) max = t
  }
  return Math.max(0, Math.round((max - min) / _day)) + 1
}
