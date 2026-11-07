// QQ 增强模式：在消息送进模型之前，给那条唤醒提示做两件事。
//
//   1) 瘦身：剪掉两块最占地方、最少用到的静态段落——「B站记忆」和「来源判断」。
//      如果这条消息本身提到了 B站/视频/动态/评论，B站记忆就不剪。
//   2) 接续：从对话档案里取这个会话最近几轮原话，压成紧凑的几行附在后面。
//
// 认不出来就原样返回（调用方据此放行），绝不硬改。观察模式下只统计、不改。

export const MARKER = '⟦dca:enhanced⟧'

const BILI_BLOCK = /##\s*B站记忆[^\n]*\n[\s\S]*?(?=\n【[^\n]*】|\n##\s|$)/
const SOURCE_BLOCK = /【来源判断】[\s\S]*?(?=\n【[^\n]*】|\n##\s|$)/
const BILI_TOPIC = /B站|b站|视频|动态|评论|弹幕|up主|UP主|投稿|直播/

/** 这条文本像不像一条 QQ 唤醒提示。 */
export function looksLikeQQWake(text) {
  const t = String(text ?? '')
  return t.includes('【当前会话】') && t.includes('【唤醒】')
}

/**
 * @returns {{ text: string, stats: { total: number, bili: number, source: number, continuity: number, changed: boolean } }}
 */
export function enhanceWakeText(text, { continuity = '', observe = true } = {}) {
  const original = String(text ?? '')
  const stats = { total: original.length, bili: 0, source: 0, continuity: 0, changed: false }
  if (!looksLikeQQWake(original)) return { text: original, stats }
  if (original.includes(MARKER)) return { text: original, stats }

  let out = original

  // 只在「这一轮真正的消息」没涉及 B站 时剪 B站记忆。
  // 注意不能用整段前缀来判断：B站记忆这一块自己就满是「B站」二字，会把条件永远判成真。
  const snapshotAt = original.indexOf('【本次消息快照】')
  const incoming = snapshotAt >= 0 ? original.slice(snapshotAt) : (original.split('【唤醒】')[1] ?? '')
  const keepBili = BILI_TOPIC.test(incoming)
  if (!keepBili) {
    const m = BILI_BLOCK.exec(out)
    if (m) {
      stats.bili = m[0].length
      out = out.replace(m[0], '## B站记忆（本轮略去；需要时用 B站 工具查）')
    }
  }

  const s = SOURCE_BLOCK.exec(out)
  if (s) {
    stats.source = s[0].length
    out = out.replace(s[0], '【来源判断】按载体判断来源；拿不准则问一句，或查对话档案。')
  }

  if (continuity) {
    out = `${out}\n\n【档案补记 · 本会话最近几轮】\n${continuity}\n${MARKER}`
    stats.continuity = continuity.length
  }

  stats.changed = out !== original
  return { text: observe ? original : out, stats }
}

/** 把档案记录压成紧凑的几行。 */
export function formatContinuity(records, { limit = 8, maxChars = 60 } = {}) {
  const picked = records.slice(-limit)
  const lines = []
  for (const r of picked) {
    if (r?.sensitivity === 'private' && r?.masked) continue
    const when = new Date(r.time ?? 0)
    const hh = String(when.getHours()).padStart(2, '0')
    const mm = String(when.getMinutes()).padStart(2, '0')
    const who = r.role === 'user' ? '对方' : '我'
    const body = String(r.text ?? '').replace(/\s+/g, ' ').trim()
    if (!body) continue
    lines.push(`${hh}:${mm} ${who}：${body.length > maxChars ? `${body.slice(0, maxChars)}…` : body}`)
  }
  return lines.join('\n')
}
