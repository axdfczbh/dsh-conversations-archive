// QQ / B站 对话抽取。
//
// 实测的载体（2026-11-07 读过真实会话）：
//   QQ —— 我说的话在工具调用参数里：
//        mcp__snowluma__qq_send_message      args.messages（字符串或数组）
//        mcp__snowluma__qq_send_private_message / qq_send_group_message / qq_reply  args.message
//        对方说的话在工具结果里：qq_wait_for_messages / qq_get_unread_messages /
//        qq_get_recent_messages 返回的 JSON 里带 newMessages / messages。
//        （QQ 会话里的 user/message 是桥接塞的唤醒提示，不是人话，不走这里。）
//   B站 —— 我发出去的东西要靠解析命令：bili.mjs daily/comment/dm --text "..."，
//        有时正文先赋给变量再 `--text $t`，所以两种写法都认。

import { redact } from './redact.mjs'

const QQ_SEND_MULTI = new Set(['mcp__snowluma__qq_send_message'])
const QQ_SEND_SINGLE = new Set([
  'mcp__snowluma__qq_send_private_message',
  'mcp__snowluma__qq_send_group_message',
  'mcp__snowluma__qq_reply',
])
const QQ_INBOUND = /qq_(wait_for_messages|get_unread_messages|get_recent_messages)$/
const QQ_GET_MEDIA = 'mcp__snowluma__qq_get_message_images'
const QQ_COLLECT = 'mcp__snowluma__qq_collect_sticker'
const QQ_SEND_STICKER = 'mcp__snowluma__qq_send_sticker'

const BILI_WRITE = /bili\.mjs"?\s+(daily|comment|dm|reply)\b/

function classify(cwd) {
  const c = String(cwd ?? '').toLowerCase().replace(/\//g, '\\')
  if (c.includes('surfcore\\state\\agents')) return 'qq'
  if (c.includes('bili-agents')) return 'bili'
  return 'dsh'
}

function scopeOf(key) {
  const k = String(key ?? '')
  if (k.startsWith('group:')) return 'group'
  if (k.startsWith('private:')) return 'private'
  return ''
}

function makeRecord({ sessionId, seq, time, source, role, text, via, media }) {
  const body = String(text ?? '').trim()
  if (!body) return null
  const record = {
    id: `${sessionId}:${seq}:${via}`,
    sessionId,
    seq,
    time,
    source,
    role,
    sensitivity: source === 'bili' ? 'normal' : 'private',
    via,
    text: redact(body),
  }
  if (media) record.media = media
  return record
}

/** 工具调用 → 我说出去的话（QQ 消息 / B站 动态评论）。 */
export function recordsFromCall(sessionId, event, cwd) {
  const name = event?.data?.name
  if (typeof name !== 'string') return []
  const source = classify(cwd)
  const args = safeJson(event?.data?.arguments)
  const out = []

  if (source === 'qq' && (QQ_SEND_MULTI.has(name) || QQ_SEND_SINGLE.has(name))) {
    const list = []
    if (QQ_SEND_MULTI.has(name)) {
      const m = args?.messages
      if (Array.isArray(m)) list.push(...m)
      else if (typeof m === 'string') list.push(...splitMaybeJsonArray(m))
    } else if (typeof args?.message === 'string') {
      list.push(args.message)
    }
    list.forEach((text, i) => {
      const rec = makeRecord({
        sessionId,
        seq: event.seq,
        time: event.time,
        source: 'qq',
        role: 'assistant',
        text,
        via: `qq-sent-${i}`,
      })
      if (rec) out.push(rec)
    })
    return out
  }

  // 我发出去的表情包：没有文字，只留一条带表情标记的记录
  if (source === 'qq' && name === QQ_SEND_STICKER) {
    const stickerId = args?.stickerId ?? ''
    const rec = makeRecord({
      sessionId,
      seq: event.seq,
      time: event.time,
      source: 'qq',
      role: 'assistant',
      text: `[表情]${stickerId ? ` ${stickerId}` : ''}`,
      via: 'qq-sent-sticker',
      media: { kind: 'sticker', stickerId, scope: scopeOf(args?.key) },
    })
    return rec ? [rec] : []
  }

  if (source === 'bili' && (name === 'pwsh' || name === 'bash')) {
    const cmd = String(args?.command ?? '')
    if (!BILI_WRITE.test(cmd)) return []
    // --dry 是演练，没真发出去；只有 --dry 而没有 --go 的调用不算一条发言。
    if (/--dry\b/.test(cmd) && !/--go\b/.test(cmd)) return []
    const text = textFromCommand(cmd)
    if (text) {
      const rec = makeRecord({
        sessionId,
        seq: event.seq,
        time: event.time,
        source: 'bili',
        role: 'assistant',
        text,
        via: 'bili-post',
      })
      if (rec) out.push(rec)
    }
    return out
  }

  return out
}

/** 工具结果 → 对方说的话（QQ 收到的消息 / 图片表情）。call = { name, args }。 */
export function recordsFromResult(sessionId, event, call, cwd) {
  if (classify(cwd) !== 'qq') return []
  const callName = typeof call === 'string' ? call : call?.name
  const callArgs = typeof call === 'object' && call ? call.args : undefined

  // 表情包 / 图片：结果里只有一句标签，比如
  //   「消息 1519591685 的媒体内容（1 项）：\n[图片1 【图片：[动画表情]】（当前模型不支持图片输入，仅知标签）]」
  if (callName === QQ_GET_MEDIA) {
    const raw = textOfResult(event)
    if (!raw) return []
    const label = /\[([^\]]*表情[^\]]*)\]/.exec(raw)?.[1] ?? (/图片/.test(raw) ? '[图片]' : '[媒体]')
    const rec = makeRecord({
      sessionId,
      seq: event.seq,
      time: event.time,
      source: 'qq',
      role: 'user',
      text: `[图片] ${label}`,
      via: 'qq-media',
      media: {
        kind: /表情/.test(raw) ? 'sticker' : 'image',
        messageId: callArgs?.messageId,
        scope: scopeOf(callArgs?.key),
        label,
      },
    })
    return rec ? [rec] : []
  }

  // 收藏表情：结果里带 md5 / url，能顺手把图存下来
  if (callName === QQ_COLLECT) {
    const parsedSticker = safeJson(textOfResult(event))?.sticker
    if (!parsedSticker) return []
    const rec = makeRecord({
      sessionId,
      seq: event.seq,
      time: event.time,
      source: 'qq',
      role: 'user',
      text: `[表情]${parsedSticker.desc ? ` ${parsedSticker.desc}` : ''}`,
      via: 'qq-sticker-collected',
      media: {
        kind: 'sticker',
        messageId: callArgs?.messageId,
        scope: scopeOf(callArgs?.key),
        md5: parsedSticker.md5,
        url: parsedSticker.url,
        desc: parsedSticker.desc,
        emotion: parsedSticker.emotion,
      },
    })
    return rec ? [rec] : []
  }

  if (typeof callName !== 'string' || !QQ_INBOUND.test(callName)) return []
  const parsed = safeJson(textOfResult(event))
  if (!parsed) return []

  const list = []
  for (const key of ['newMessages', 'messages', 'items']) {
    if (Array.isArray(parsed[key])) list.push(...parsed[key])
  }
  if (list.length === 0 && parsed.data && Array.isArray(parsed.data.messages)) list.push(...parsed.data.messages)

  const out = []
  list.forEach((m, i) => {
    const body = typeof m === 'string' ? m : (m?.text ?? m?.content ?? m?.message ?? '')
    const rec = makeRecord({
      sessionId,
      seq: event.seq,
      time: event.time,
      source: 'qq',
      role: 'user',
      text: body,
      via: `qq-recv-${i}`,
    })
    if (rec) out.push(rec)
  })
  return out
}

function textOfResult(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('')
}

function splitMaybeJsonArray(value) {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    // 不是 JSON 就当成一句话
  }
  return [value]
}

/** 从 bili.mjs 命令行里取出要发出去的正文。 */
export function textFromCommand(cmd) {
  const direct = /--text\s+"([^"]*)"/.exec(cmd) ?? /--text\s+'([^']*)'/.exec(cmd)
  if (direct && direct[1] && !direct[1].startsWith('$')) return direct[1]
  // --text $t 的形式：回去找 $t = "...." 的赋值
  const varMatch = /--text\s+\$([A-Za-z_][\w]*)/.exec(cmd)
  if (varMatch) {
    const v = varMatch[1]
    const assign = new RegExp(`\\$${v}\\s*=\\s*"([\\s\\S]*?)"\\s*;`, 'm').exec(cmd)
    if (assign?.[1]) return assign[1]
  }
  if (direct?.[1]) return direct[1]
  return ''
}

function safeJson(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}
