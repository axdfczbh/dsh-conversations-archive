// 窗口归属：一条对话是从哪个窗口说出来的。
// 依据 DSH 自己的工作区登记表（storages/workspace.json），里面记着
// 每个工作区的标题和它名下的会话 id；对不上时退回用 cwd 的末段目录名。

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

let cache = null

function registryPath() {
  return join(homedir(), '.dsh', 'storages', 'workspace.json')
}

/** @returns {{ bySession: Map<string,string>, byPath: Map<string,string>, defaultTitle: string }} */
export function loadWindows(file = registryPath()) {
  const empty = { bySession: new Map(), byPath: new Map(), defaultTitle: '' }
  try {
    if (!existsSync(file)) return empty
    const st = statSync(file)
    if (cache && cache.size === st.size && cache.mtimeMs === st.mtimeMs) return cache.value
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    const bySession = new Map()
    const byPath = new Map()
    let defaultTitle = ''
    for (const [id, ws] of Object.entries(doc?.tables?.workspaces ?? {})) {
      if (!ws?.title) continue
      if (id === doc?.global?.defaultWorkspaceId) defaultTitle = ws.title
      if (ws.path) byPath.set(normalizePath(ws.path), ws.title)
      for (const sid of ws.sessionIds ?? []) bySession.set(sid, ws.title)
    }
    const value = { bySession, byPath, defaultTitle }
    cache = { size: st.size, mtimeMs: st.mtimeMs, value }
    return value
  } catch {
    return empty
  }
}

/** 优先级：登记表里的会话归属 → cwd 对应的窗口 → cwd 末段 → 未知。 */
export function windowOf(sessionId, cwd, windows) {
  const w = windows ?? loadWindows()
  return (
    w.bySession.get(sessionId) ??
    (cwd ? w.byPath.get(normalizePath(cwd)) : undefined) ??
    (cwd ? basename(normalizePath(cwd)) : undefined) ??
    w.defaultTitle ??
    '未知窗口'
  )
}

export function normalizePath(p) {
  return String(p ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}
