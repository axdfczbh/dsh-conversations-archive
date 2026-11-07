// 进库前脱敏：token / cookie / 密码 / 高熵串一律替换，原文不写进档案。
// 宁可多替换：档案是给自己查的，真需要找回原值可以去原始会话日志。

const RULES = [
  // 明确的秘密字段：password: xxx / "token": "xxx" / Cookie=xxx
  {
    re: /\b(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|auth(?:orization)?|cookie|session[_-]?id|cookie[_-]?string)\b(\s*[:=]\s*)(["']?)([^\s"',;&]{4,})\3/gi,
    to: (_m, name, sep) => `${name}${sep}[已脱敏]`,
  },
  // Bearer / Basic 凭据
  { re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, to: (_m, kind) => `${kind} [已脱敏]` },
  // 常见形态的密钥
  { re: /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, to: () => '[已脱敏]' },
  // 高熵串：长度 32+，同时含大小写与数字，且不是普通英文句子
  {
    re: /\b(?=[A-Za-z0-9_\-]*[a-z])(?=[A-Za-z0-9_\-]*[A-Z])(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]{32,}\b/g,
    to: () => '[已脱敏]',
  },
  // 邮箱
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, to: () => '[邮箱已脱敏]' },
  // 手机号（中国大陆）
  { re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, to: () => '[手机号已脱敏]' },
]

export function redact(text) {
  let out = String(text ?? '')
  for (const rule of RULES) out = out.replace(rule.re, rule.to)
  return out
}
