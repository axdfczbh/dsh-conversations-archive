// 插件自己的设置：存在 ~/.dsh/conversations-archive/settings.json。
// 不放进档案目录里，因为「档案放在哪」本身就是要设置的东西。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULTS = {
  // 私聊（和主人）：关 = 存原图（方案二）；开 = 只记标记（方案一）
  stickerPrivate: 'file',
  // 群：开 = 只记标记（方案一）；关 = 存原图（方案二）
  stickerGroup: 'marker',
  archiveDir: '',
  // 白名单：只有这些身份来问，私事才给全文
  ownerQq: '',
  ownerBiliUid: '',
  // QQ 增强模式：off = 不介入；observe = 只记录不改；on = 真的改写唤醒提示
  qqEnhance: 'off',
  // 更完整的来龙去脉：补记从 8 轮×60 字加到 20 轮×150 字，并加一句「档案里能查」
  qqContinuity: false,
  // B站：四类动态已关时，提示她别再调 daily、想发就用 share-dynamic（独立开关）
  biliDynamicNote: false,
  // 轻度防降智（B站）：查档案代替重读、少把工具输出倒回来、收工写日记
  antiDumbHint: false,
  configuredAt: null,
}

export function settingsPath() {
  return join(homedir(), '.dsh', 'conversations-archive', 'settings.json')
}

export function loadSettings(file = settingsPath()) {
  try {
    if (!existsSync(file)) return { ...DEFAULTS }
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch, file = settingsPath()) {
  const next = { ...loadSettings(file), ...(patch ?? {}) }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function isStickerMarker(policy) {
  return policy === 'marker'
}
