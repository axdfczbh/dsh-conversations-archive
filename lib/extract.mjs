// 从会话事件里抽「真话」：你说的话 + 我真正说出口的话。
// 工具调用、工具结果、思考过程、系统噪音一律不要。
//
// 依据实测的 0.1.7/0.2 事件结构：
//   user/message      → data.content[]（text 块），data.source.kind 区分真人与系统注入
//                       （实测值：user / runtime-context / skill-catalog / time-context / user-approval）
//   assistant/message  → data.message.content[]（reasoning / tool-call / text），只要 text

import { redact } from './redact.mjs'
import { recordsFromCall, recordsFromResult } from './platform.mjs'

const NOISE_KINDS = new Set(['runtime-context', 'skill-catalog', 'time-context', 'user-approval'])

/** 按会话 cwd 判断这条对话属于哪个平台。 */
export function classifySource(cwd) {
  const c = String(cwd ?? '').toLowerCase().replace(/\//g, '\\')
  if (c.includes('surfcore\\state\\agents')) return 'qq'
  if (c.includes('bili-agents')) return 'bili'
  return 'dsh'
}

/** v0.01 口径：DSH 与 QQ 一律按私事处理（宁严不宽），B站公开场按普通。 */
export function sensitivityOf(source) {
  return source === 'bili' ? 'normal' : 'private'
}

// v0.0.6 起：DSH 会话按 user/assistant 明文抽；
// QQ / B站 不走这两个事件——它们的原话在工具调用参数和工具结果里，由 platform.mjs 解析。
// 平台会话里仍会出现的 user/message（桥接唤醒提示）和 assistant/message（【目的】内部计划）
// 一律不进档案。
const PLATFORM_ENABLED = false

function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/** 一条事件 → 一条档案记录（或 null）。 */
export function extractOne(sessionId, event, cwdForClassify) {
  if (!event || typeof event.type !== 'string') return null
  const seq = Number.isFinite(event.seq) ? event.seq : null
  if (seq === null) return null
  const time = Number.isFinite(event.time) ? event.time : Date.now()

  if (event.type === 'user/message') {
    const kind = event.data?.source?.kind
    if (kind && NOISE_KINDS.has(kind)) return null
    if (kind && kind !== 'user') return null
    const text = textOf(event.data?.content)
    if (!text) return null
    return make(sessionId, seq, time, 'user', text, cwdForClassify)
  }

  if (event.type === 'assistant/message') {
    const text = textOf(event.data?.message?.content)
    if (!text) return null
    return make(sessionId, seq, time, 'assistant', text, cwdForClassify)
  }

  return null
}

function make(sessionId, seq, time, role, text, cwd) {
  const source = classifySource(cwd)
  if (!PLATFORM_ENABLED && source !== 'dsh') return null
  return {
    id: `${sessionId}:${seq}`,
    sessionId,
    seq,
    time,
    source,
    role,
    sensitivity: sensitivityOf(source),
    text: redact(text),
  }
}

/** 会话头里的 cwd（用来判断平台）。 */
export function sessionCwd(events) {
  for (const e of events) {
    if (e?.type === 'session') return e.cwd ?? ''
  }
  return ''
}

/**
 * 有状态的抽取器：除了明文事件，还要把 tool/call 与 tool/result 按 callId 配对，
 * 才能知道「这条结果是谁返回的」，从里面取出 QQ 收到的消息。
 * 同一条管线同时用于历史回补和实时抓取。
 */
export function createExtractor() {
  const calls = new Map() // callId -> { name, args }

  return {
    consume(sessionId, event, cwd) {
      if (!event || typeof event.type !== 'string') return []

      if (event.type === 'tool/call') {
        const callId = event.data?.callId
        if (callId) {
          calls.set(callId, { name: event.data?.name, args: parseArgs(event.data?.arguments) })
        }
        return recordsFromCall(sessionId, event, cwd)
      }

      if (event.type === 'tool/result') {
        const callId = event.data?.message?.source?.callId ?? event.data?.toolCallId
        const call = callId ? calls.get(callId) : undefined
        return recordsFromResult(sessionId, event, call, cwd)
      }

      const rec = extractOne(sessionId, event, cwd)
      return rec ? [rec] : []
    },
  }
}

function parseArgs(value) {
  if (value == null) return undefined
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return undefined
  }
}

/** 整个会话的事件数组 → 记录数组。 */
export function extractSession(sessionId, events, cwdOverride) {
  const cwd = cwdOverride ?? sessionCwd(events)
  const extractor = createExtractor()
  const out = []
  for (const e of events) out.push(...extractor.consume(sessionId, e, cwd))
  return out
}
