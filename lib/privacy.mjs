// 谁在提问：决定能不能看到私事正文。
//
// 规则（2026-11-07 定）：
//   · DSH 本地窗口 = 主人本人 → 全文。
//   · QQ 私聊且对方是白名单里的号 → 全文。
//   · QQ 群 / B站 / 来源不明 → 只给时间和「私事」标记，正文由程序截掉，
//     模型手里根本没有原文，它想说得具体也做不到。
//
// 「谁在提问」不靠模型自报，靠两个结构信号：
//   1) 会话 id → 该会话的 cwd（判断平台）；
//   2) QQ 会话的唤醒提示里写着「QQ 私聊｜private:123456789」这种会话 key。

const KEY_PATTERN = /(private|group):(\d{4,})/

/** 从一段文本里找出 QQ 会话 key。 */
export function parseScopeKey(text) {
  const m = KEY_PATTERN.exec(String(text ?? ''))
  if (!m) return null
  return { kind: m[1], id: m[2] }
}

/** 平台判断，和 extract.mjs 的 classifySource 保持一致。 */
export function platformOf(cwd) {
  const c = String(cwd ?? '').toLowerCase().replace(/\//g, '\\')
  if (c.includes('surfcore\\state\\agents')) return 'qq'
  if (c.includes('bili-agents')) return 'bili'
  return 'dsh'
}

/**
 * @returns {'owner'|'public'} owner = 可以对私事看全文
 */
export function audienceOf({ cwd, scope, ownerQq, ownerBiliUid }) {
  const platform = platformOf(cwd)
  if (platform === 'dsh') return 'owner'
  if (platform === 'qq') {
    if (scope?.kind === 'private' && String(scope.id) === String(ownerQq)) return 'owner'
    return 'public'
  }
  if (platform === 'bili') {
    // B站 是公开场。只有明确认出是主人的私信才等同本人（目前会话里没有这层信息，按公开处理）。
    return scope?.kind === 'private' && String(scope.id) === String(ownerBiliUid) ? 'owner' : 'public'
  }
  return 'public'
}

/** 把一个私事记录压成「只留时间和标记」的版本。 */
export function maskRecord(record) {
  return {
    time: record.time,
    source: record.source,
    role: record.role,
    sessionId: record.sessionId,
    seq: record.seq,
    sensitivity: 'private',
    masked: true,
    text: '（私事，内容不展示）',
  }
}
