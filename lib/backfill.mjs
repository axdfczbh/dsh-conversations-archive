// 历史回补与体检。
// 回补：把 sessions 下已有的会话文件全部解一遍，抽取后并入档案（幂等）。
// 体检：拿原始会话算出「应该有多少条」，和档案里的对一遍，报缺口。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { decodeMultiFrame, parseEvents } from './decode.mjs'
import { extractSession } from './extract.mjs'
import { appendRecords, ensureArchiveFile, readRecords } from './store.mjs'

const SESSION_FILE = 'session.v4.jsonl.zstd'

/** 列出所有会话文件。 */
export function listSessionFiles(sessionsRoot) {
  const out = []
  if (!existsSync(sessionsRoot)) return out
  for (const project of safeReaddir(sessionsRoot)) {
    const projectDir = join(sessionsRoot, project.name)
    if (!project.isDirectory()) continue
    for (const session of safeReaddir(projectDir)) {
      // B站 那个会话目录叫 bili-whale-deepseek，不带 session- 前缀，
      // 所以只认「目录里有 session.v4.jsonl.zstd」，不按名字过滤。
      if (!session.isDirectory()) continue
      const file = join(projectDir, session.name, SESSION_FILE)
      if (!existsSync(file)) continue
      out.push({ sessionId: session.name, file, size: statSync(file).size })
    }
  }
  return out
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** 回补一个文件。返回 { sessionId, events, records, appended, badFrames }。 */
export function backfillFile(file, archiveFile, sessionId, ids, { decorate } = {}) {
  ensureArchiveFile(archiveFile)
  const raw = readFileSync(file)
  const { text, skipped } = decodeMultiFrame(raw)
  const events = parseEvents(text)
  const records = extractSession(sessionId, events)
  decorate?.(records)
  const appended = appendRecords(archiveFile, records, ids)
  return { sessionId, events: events.length, records: records.length, appended, badFrames: skipped.length }
}

/** 回补整个 sessions 根目录。 */
export function backfillAll(sessionsRoot, archiveFile, { onProgress, decorate } = {}) {
  const files = listSessionFiles(sessionsRoot)
  const ids = new Set(readRecords(archiveFile).map((r) => r.id))
  const results = []
  let appended = 0
  let failed = 0
  for (const { file, sessionId } of files) {
    try {
      const r = backfillFile(file, archiveFile, sessionId, ids, { decorate })
      appended += r.appended
      results.push(r)
    } catch (error) {
      failed += 1
      results.push({ sessionId, error: error?.message ?? String(error) })
    }
    onProgress?.(results.length, files.length)
  }
  return { sessions: files.length, appended, failed, results }
}

/** 体检：每个会话「应该几条 / 档案里几条」，报缺口。 */
export function healthCheck(sessionsRoot, archiveFile) {
  const archived = new Map()
  for (const r of readRecords(archiveFile)) {
    const cur = archived.get(r.sessionId) ?? { count: 0, maxSeq: -1 }
    cur.count += 1
    if ((r.seq ?? 0) > cur.maxSeq) cur.maxSeq = r.seq ?? 0
    archived.set(r.sessionId, cur)
  }

  const perSession = []
  let missing = 0
  let badFrames = 0
  for (const { file, sessionId } of listSessionFiles(sessionsRoot)) {
    try {
      const { text, skipped } = decodeMultiFrame(readFileSync(file))
      badFrames += skipped.length
      const expected = extractSession(sessionId, parseEvents(text)).length
      const got = archived.get(sessionId)?.count ?? 0
      const gap = Math.max(0, expected - got)
      missing += gap
      perSession.push({ sessionId, expected, archived: got, gap })
    } catch (error) {
      perSession.push({ sessionId, error: error?.message ?? String(error) })
    }
  }

  return {
    sessionsRoot,
    archiveFile,
    sessionsOnDisk: perSession.length,
    sessionsInArchive: archived.size,
    missing,
    badFrames,
    perSession: perSession.filter((s) => s.error || s.gap > 0),
  }
}
