// 对话档案室（conversations archive）· v0.0.8 · Host 半边
//
// 做四件事：
//   1) 实时：订阅 session/event，每条新事件抽正文、脱敏、追加一行进档案；
//   2) 回补：把 sessions 下已有的会话全部解一遍并入档案（只追加、幂等）；
//   3) 检索：注册 search_conversations / archive_health；
//   4) 设置：路径、QQ 表情包策略、清理图片，通过 /api/conversations-archive/* 暴露给设置页。

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { appendRecords, ensureArchiveFile, loadIds, readRecords } from './lib/store.mjs'
import { createExtractor, sessionCwd } from './lib/extract.mjs'
import { backfillAll, healthCheck, listSessionFiles } from './lib/backfill.mjs'
import { searchRecords, formatHit, stats } from './lib/search.mjs'
import { loadWindows, windowOf } from './lib/windows.mjs'
import { decodeMultiFrame, parseEvents } from './lib/decode.mjs'
import { loadSettings, saveSettings, settingsPath } from './lib/settings.mjs'
import { purgeMedia, mediaExists } from './lib/media.mjs'
import { audienceOf, parseScopeKey, maskRecord, platformOf } from './lib/privacy.mjs'
import { enhanceWakeText, formatContinuity, looksLikeQQWake, MARKER } from './lib/enhance.mjs'

export const name = 'conversations-archive'
export const inject = ['tools']

const DEFAULT_ARCHIVE_DIR = ''

export function apply(ctx, config) {
  const log = (msg) => console.log(`[conversations-archive] ${msg}`)
  const row = config ?? {}

  let settings = loadSettings()
  // 老版本把路径写在插件行配置里；第一次升级时把它迁到设置文件，视为「已经选过」。
  if (!settings.archiveDir && row.archiveDir) {
    settings = saveSettings({ archiveDir: row.archiveDir, configuredAt: new Date().toISOString() })
  }

  const sessionsRoot = row.sessionsRoot || join(homedir(), '.dsh', 'sessions')
  const autoBackfill = row.autoBackfill !== false
  const purgeLog = join(homedir(), '.dsh', 'conversations-archive', 'purge-log.jsonl')

  const rt = { archiveDir: '', archiveFile: '', mediaDir: '', ids: new Set() }

  const activationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // 开机时加载：进程刚起来不久；晚于这个窗口才被加载的，多半是用户手动启用。
  const bootLoad = process.uptime() < 60

  const status = {
    ok: true,
    error: null,
    activationId,
    bootLoad,
    configured: Boolean(settings.archiveDir),
    archiveDir: settings.archiveDir || '',
    archiveFile: '',
    total: 0,
    lastWrite: null,
    bySource: {},
    mediaFiles: 0,
    settingsFile: settingsPath(),
    updatedAt: new Date().toISOString(),
  }

  const downloading = new Set()

  function applyDir(dir) {
    rt.archiveDir = dir
    rt.archiveFile = join(dir, 'conversations.jsonl')
    rt.mediaDir = join(dir, 'media', 'qq')
    ensureArchiveFile(rt.archiveFile)
    rt.ids = loadIds(rt.archiveFile)
    status.archiveDir = dir
    status.archiveFile = rt.archiveFile
    status.configured = true
  }

  function refreshStatus(patch = {}) {
    try {
      const s = rt.archiveFile ? stats(readRecords(rt.archiveFile)) : { total: 0, bySource: {}, lastWrite: null }
      Object.assign(status, { total: s.total, lastWrite: s.lastWrite, bySource: s.bySource }, patch)
      status.settings = {
        stickerPrivate: settings.stickerPrivate,
        stickerGroup: settings.stickerGroup,
        qqEnhance: settings.qqEnhance,
        qqContinuity: settings.qqContinuity === true,
        biliDynamicNote: settings.biliDynamicNote === true,
        antiDumbHint: settings.antiDumbHint === true,
      }
      status.updatedAt = new Date().toISOString()
      if (rt.archiveDir) writeFileSync(join(rt.archiveDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8')
    } catch (error) {
      status.ok = false
      status.error = String(error?.message ?? error)
    }
  }

  // 表情包 / 图片：先按设置决定「存不存图」，再决定下不下。
  //   私聊：stickerPrivate；群：stickerGroup。'marker' = 方案一（只留标记），'file' = 方案二（存原图）。
  const policyFor = (scope) => (scope === 'group' ? settings.stickerGroup : settings.stickerPrivate)

  function downloadMedia(rec) {
    const media = rec?.media
    if (!media?.url || !media?.md5) return
    if (policyFor(media.scope) === 'marker') {
      delete media.url
      return
    }
    media.file = `media/qq/${media.md5}.jpg`
    const target = join(rt.mediaDir, `${media.md5}.jpg`)
    if (downloading.has(target) || existsSync(target)) return
    downloading.add(target)
    ;(async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10000)
        const res = await fetch(media.url, { signal: controller.signal })
        clearTimeout(timer)
        if (!res.ok) return
        const buf = Buffer.from(await res.arrayBuffer())
        mkdirSync(rt.mediaDir, { recursive: true })
        writeFileSync(target, buf)
      } catch (error) {
        console.error(`[conversations-archive] 图片下载失败：${error?.message ?? error}`)
      } finally {
        downloading.delete(target)
      }
    })()
  }

  const applyMediaPolicy = (recs) => {
    for (const rec of recs) downloadMedia(rec)
  }

  if (settings.archiveDir) applyDir(settings.archiveDir)
  refreshStatus()

  // ---------- 给设置页用的小接口（只读状态 + 两个写操作） ----------
  const webServer = ctx.get('webServer')
  if (webServer) {
    const json = (res, code, value) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(value))
    }
    const readBody = (req) =>
      new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > 64 * 1024) {
            reject(new Error('请求体太大'))
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          try {
            resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
          } catch (error) {
            reject(error)
          }
        })
        req.on('error', reject)
      })

    // 宿主认证：这三个接口都要经过 connection 准入，未认证一律拒绝。
    // 认证不可用（没有 connection 服务、或调用抛错）时同样拒绝，不做降级放行。
    const requireAdmission = (req, res) => {
      let connection
      try {
        connection = ctx.get('connection')
      } catch (error) {
        connection = undefined
      }
      if (!connection || typeof connection.admit !== 'function') {
        json(res, 503, { ok: false, error: '宿主认证不可用，请求已拒绝' })
        return false
      }
      let admission
      try {
        admission = connection.admit(req)
      } catch (error) {
        json(res, 503, { ok: false, error: `宿主认证失败：${error?.message ?? error}` })
        return false
      }
      if (admission && typeof admission.rejection === 'number') {
        json(res, admission.rejection, { ok: false, error: '未通过宿主认证的请求' })
        return false
      }
      return true
    }

    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/api/conversations-archive/status',
        handler: (req, res) => {
          if (!requireAdmission(req, res)) return
          return json(res, 200, status)
        },
      }),
    )

    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/api/conversations-archive/settings',
        handler: async (req, res) => {
          if (!requireAdmission(req, res)) return
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只接受 POST' })
          try {
            const body = await readBody(req)
            const patch = {}
            if (typeof body.archiveDir === 'string' && body.archiveDir.trim()) {
              const dir = body.archiveDir.trim()
              mkdirSync(dir, { recursive: true })
              const probe = join(dir, '.write-probe')
              writeFileSync(probe, 'ok', 'utf8')
              patch.archiveDir = dir
              patch.configuredAt = new Date().toISOString()
            }
            if (body.stickerPrivate === 'marker' || body.stickerPrivate === 'file') patch.stickerPrivate = body.stickerPrivate
            if (body.stickerGroup === 'marker' || body.stickerGroup === 'file') patch.stickerGroup = body.stickerGroup
            if (body.qqEnhance === 'off' || body.qqEnhance === 'observe' || body.qqEnhance === 'on') {
              patch.qqEnhance = body.qqEnhance
            }
            if (typeof body.qqContinuity === 'boolean') patch.qqContinuity = body.qqContinuity
            if (typeof body.biliDynamicNote === 'boolean') patch.biliDynamicNote = body.biliDynamicNote
            if (typeof body.antiDumbHint === 'boolean') patch.antiDumbHint = body.antiDumbHint

            const before = settings.archiveDir
            settings = saveSettings(patch)
            if (settings.archiveDir && settings.archiveDir !== before) {
              applyDir(settings.archiveDir)
              refreshStatus()
              if (autoBackfill) setTimeout(runBackfill, 300)
            } else {
              refreshStatus()
            }
            return json(res, 200, { ok: true, settings, status })
          } catch (error) {
            status.ok = false
            status.error = String(error?.message ?? error)
            return json(res, 400, { ok: false, error: `保存失败：${error?.message ?? error}` })
          }
        },
      }),
    )

    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/api/conversations-archive/purge',
        handler: async (req, res) => {
          if (!requireAdmission(req, res)) return
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只接受 POST' })
          try {
            const body = await readBody(req)
            const until = typeof body.until === 'number' ? body.until : Date.parse(String(body.until ?? ''))
            if (!Number.isFinite(until)) return json(res, 400, { ok: false, error: '时间点无效' })
            if (!rt.archiveFile) return json(res, 400, { ok: false, error: '还没有设置档案路径' })
            const summary = purgeMedia(readRecords(rt.archiveFile), {
              until,
              archiveDir: rt.archiveDir,
              logFile: purgeLog,
            })
            status.lastPurge = summary
            refreshStatus()
            return json(res, 200, { ok: true, summary, status })
          } catch (error) {
            return json(res, 400, { ok: false, error: `清理失败：${error?.message ?? error}` })
          }
        },
      }),
    )
  }

  // ---------- 实时 ----------
  const cwds = new Map()
  const sessionScopes = new Map() // sessionId -> { kind: 'private'|'group', id }
  const liveExtractor = createExtractor()

  const rememberScope = (sessionId, event) => {
    if (event?.type !== 'user/message') return
    const text = (event.data?.content ?? [])
      .filter((c) => c?.type === 'text')
      .map((c) => c.text)
      .join('')
    const scope = parseScopeKey(text)
    if (scope) sessionScopes.set(sessionId, scope)
  }

  ctx.on('session/event', (session, event) => {
    try {
      if (!rt.archiveFile) return // 还没选路径，先不收录
      const sessionId = session?.id ?? session?.sessionId ?? event?.sessionId
      if (!sessionId) return
      if (event?.type === 'session') {
        if (event.cwd) cwds.set(sessionId, event.cwd)
        return
      }
      rememberScope(sessionId, event)
      const cwd = cwds.get(sessionId) ?? session?.header?.cwd ?? session?.record?.identity?.cwd ?? ''
      const recs = liveExtractor.consume(sessionId, event, cwd)
      if (recs.length === 0) return
      applyMediaPolicy(recs)
      appendRecords(rt.archiveFile, recs, rt.ids)
    } catch (error) {
      console.error(`[conversations-archive] 实时写入失败：${error?.message ?? error}`)
    }
  })

  // ---------- QQ 增强模式：在消息送去模型之前动手术 ----------
  // 只对 QQ 那类会话生效；off 完全不介入，observe 只记日志，on 才真的改写。
  const enhanceLog = join(homedir(), '.dsh', 'conversations-archive', 'enhance-log.jsonl')
  const enhanceTurns = new Set()

  const textOfMessage = (message) =>
    (message?.content ?? [])
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('')

  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      const agentId = payload?.agent?.id
      const messages = payload?.messages ?? []
      if (!agentId || messages.length === 0) return next()
      const platform = platformOf(cwds.get(agentId))

      // B站 的两项提示（各自独立开关，默认都关）：
      //   · biliDynamicNote：四类动态已关，别再调 daily，想发就用 share-dynamic
      //   · antiDumbHint：轻度防降智——查档案代替重读、少倒回工具输出、收工写日记
      if (platform === 'bili' && (settings.biliDynamicNote === true || settings.antiDumbHint === true)) {
        const turnKeyBili = `${agentId}:${payload.turn}:bili`
        if (!enhanceTurns.has(turnKeyBili)) {
          const wakeMsg = messages[messages.length - 1]
          const wakeText = textOfMessage(wakeMsg)
          if (wakeText && !wakeText.includes('⟦dca:bili-note⟧')) {
            const parts = []

            if (settings.antiDumbHint === true) {
              parts.push(
                '【别把自己拖笨】这个会话跑久了会越来越挤。三条省力习惯：' +
                  '① 想要旧事就直接查 search_conversations，别把视频重新读一遍；' +
                  '② 看视频/评论时尽量少往对话里倒东西（debrief 用 --top 3、--no-frames，少跑 --help 和目录列举）；' +
                  '③ 收工时把结论写进日记，明天的新会话靠日记和档案接上。',
              )
            }
            if (settings.biliDynamicNote === true && /四类|发动态|动态提醒|该发动态/.test(wakeText)) {
              parts.push(
                '【动态这件事】四类动态已经在设置里关掉了：不要再调用 daily，那条路会直接拒绝。' +
                  '想分享就挑一个你真觉得值得的视频，用 share-dynamic（转发卡片 + 你自己写的正文，要打分 ≥13）；' +
                  '不想发就不发，今天一条动态都没有也算正常的一天。',
              )
            }

            if (parts.length) {
              const note = `\n\n${parts.join('\n\n')}⟦dca:bili-note⟧`

              try {
                mkdirSync(join(homedir(), '.dsh', 'conversations-archive'), { recursive: true })
                appendFileSync(
                  enhanceLog,
                  JSON.stringify({
                    at: new Date().toISOString(),
                    agentId,
                    turn: payload.turn,
                    platform: 'bili',
                    applied: note.length,
                  }) + '\n',
                  'utf8',
                )
              } catch {}

              enhanceTurns.add(turnKeyBili)
              const replaced = messages.map((m) =>
                m === wakeMsg
                  ? {
                      ...m,
                      content: m.content.map((c) =>
                        c?.type === 'text' && typeof c.text === 'string' ? { ...c, text: c.text + note } : c,
                      ),
                    }
                  : m,
              )
              return { kind: 'enter', messages: replaced }
            }
          }
        }
      }

      const mode = settings.qqEnhance
      if (mode !== 'observe' && mode !== 'on') return next()
      if (platform !== 'qq') return next()

      const target = messages.find((m) => {
        const text = textOfMessage(m)
        return looksLikeQQWake(text) && !text.includes(MARKER)
      })
      if (!target) return next()

      const turnKey = `${agentId}:${payload.turn}`
      if (enhanceTurns.has(turnKey)) return next()

      const original = textOfMessage(target)
      // 来龙去脉的厚度由设置决定：默认 8 轮×60 字；打开后 20 轮×150 字，并附一句指路。
      const rich = settings.qqContinuity === true
      const contOpts = rich ? { limit: 20, maxChars: 150 } : { limit: 8, maxChars: 60 }
      const contLines = formatContinuity(
        readRecords(rt.archiveFile)
          .filter((r) => r.sessionId === agentId)
          .sort((a, b) => a.time - b.time)
          .slice(-contOpts.limit),
        contOpts,
      )
      const continuity = rich
        ? `（档案室里有完整的来龙去脉，想不起来可以直接查 search_conversations）\n${contLines}`
        : contLines
      const { text: nextText, stats: enhStats } = enhanceWakeText(original, {
        continuity,
        observe: mode !== 'on',
      })

      try {
        mkdirSync(join(homedir(), '.dsh', 'conversations-archive'), { recursive: true })
        appendFileSync(
          enhanceLog,
          JSON.stringify({ at: new Date().toISOString(), agentId, turn: payload.turn, mode, ...enhStats }) + '\n',
          'utf8',
        )
      } catch {
        // 日志写不进去不影响主流程
      }

      if (mode !== 'on' || !enhStats.changed) return next()

      enhanceTurns.add(turnKey)
      const replaced = messages.map((m) =>
        m === target
          ? {
              ...m,
              content: m.content.map((c) =>
                c?.type === 'text' && looksLikeQQWake(c.text) ? { ...c, text: nextText } : c,
              ),
            }
          : m,
      )
      return { kind: 'enter', messages: replaced }
    } catch (error) {
      console.error(`[conversations-archive] 增强模式出错，按原样放行：${error?.message ?? error}`)
      return next()
    }
  })

  // ---------- 回补 ----------
  function runBackfill() {
    if (!rt.archiveFile) return
    try {
      const r = backfillAll(sessionsRoot, rt.archiveFile, { decorate: applyMediaPolicy })
      log(`回补完成：${r.sessions} 个会话，新写入 ${r.appended} 条，失败 ${r.failed} 个`)
      collectCwds(sessionsRoot, cwds, sessionScopes)
      refreshStatus({ lastBackfill: { sessions: r.sessions, appended: r.appended, failed: r.failed } })
    } catch (error) {
      console.error(`[conversations-archive] 回补失败：${error?.message ?? error}`)
      refreshStatus({ ok: false, error: `回补失败：${error?.message ?? error}` })
    }
  }

  if (rt.archiveFile) {
    if (autoBackfill) {
      ctx.effect(() => {
        const timer = setTimeout(runBackfill, 1500)
        return () => clearTimeout(timer)
      })
    } else {
      collectCwds(sessionsRoot, cwds, sessionScopes)
    }
  } else {
    log('还没有选择档案路径，先不收录；到「设置 → 对话档案室」里选一个目录。')
    collectCwds(sessionsRoot, cwds, sessionScopes)
  }

  // ---------- 工具 ----------
  ctx.effect(() =>
    ctx.tools.register({
      name: 'search_conversations',
      description:
        '检索「对话档案室」：把主人和我在各个 DSH 窗口里说过的原话，按关键词（中文直接子串匹配）+ 可选时间范围查出来，' +
        '每条带时间、窗口名与会话 id。档案只追加不修改。' +
        '收三处：DSH 窗口、QQ（我发出去的和收到的）、B站（我发出去的动态与评论）。' +
        '注意：私事（DSH 与 QQ 私聊）只有主人本人来问才给全文；从群或 B站 这类公开场调用时，' +
        '私事条目只返回时间和「内容不展示」，这是程序截断的，不是让你自己删减。' +
        '和上下文压缩工具的 search_context 不是一回事。' +
        '想不起来的旧事可以来这里查。查不查由你决定；忘了就说忘了，不算失职。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，或一句话里的短语' },
          since: { type: 'string', description: '起始时间，YYYY-MM-DD 或 ISO 时间，可省略' },
          until: { type: 'string', description: '截止时间，YYYY-MM-DD 或 ISO 时间，可省略' },
          limit: { type: 'integer', description: '返回条数，默认 10，最多 50' },
          source: { type: 'string', enum: ['dsh', 'qq', 'bili'], description: '只看某个平台，可省略' },
        },
        required: ['query'],
      },
      output: {
        schema: { type: 'object', properties: { total: { type: 'integer' }, hits: { type: 'array', items: { type: 'object' } } } },
        render(_args, value) {
          const hits = value?.hits ?? []
          if (hits.length === 0) return [{ type: 'text', text: '档案里没有匹配的条目，或者还没设置档案路径。' }]
          return [{ type: 'text', text: hits.map((h) => h.display).join('\n\n') }]
        },
      },
      async execute(args, exec) {
        if (!rt.archiveFile) return { total: 0, hits: [], note: '还没有选择档案路径' }
        const records = readRecords(rt.archiveFile)
        const hits = searchRecords(records, args ?? {})
        const windows = loadWindows()

        // 谁在提问：由会话 id → cwd 与 QQ 会话 key 推断，不信模型自报。
        const callerId = exec?.agent?.id
        const audience = audienceOf({
          cwd: callerId ? (cwds.get(callerId) ?? '') : '',
          scope: callerId ? sessionScopes.get(callerId) : undefined,
          ownerQq: settings.ownerQq,
          ownerBiliUid: settings.ownerBiliUid,
        })

        return {
          total: records.length,
          audience,
          hits: hits.map((r) => {
            const windowTitle = windowOf(r.sessionId, cwds.get(r.sessionId), windows)
            if (audience !== 'owner' && r.sensitivity === 'private') {
              const masked = maskRecord(r)
              return {
                time: new Date(r.time).toISOString(),
                sessionId: r.sessionId,
                seq: r.seq,
                source: r.source,
                window: windowTitle,
                role: r.role,
                masked: true,
                text: masked.text,
                display: formatHit({ ...r, text: masked.text }, { windowTitle }),
              }
            }
            const hit = {
              time: new Date(r.time).toISOString(),
              sessionId: r.sessionId,
              seq: r.seq,
              source: r.source,
              window: windowTitle,
              role: r.role,
              text: r.text,
              display: formatHit(r, { windowTitle }),
            }
            if (r.media) {
              hit.media = {
                ...r.media,
                file: r.media.file && mediaExists(r, rt.archiveDir) ? r.media.file : null,
              }
            }
            return hit
          }),
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'archive_health',
      description:
        '对话档案室体检：报告档案条数、最后写入时间、各平台分布；verify=true 时逐个会话核对原始日志并报缺口（慢几秒）。',
      parameters: {
        type: 'object',
        properties: { verify: { type: 'boolean', description: '是否逐个会话核对原始日志，默认 false' } },
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } } },
        render(_args, value) {
          return [{ type: 'text', text: String(value?.summary ?? '') }]
        },
      },
      async execute(args) {
        if (!rt.archiveFile) {
          return { ok: false, summary: '还没有选择档案路径。到「设置 → 对话档案室」里选一个目录。' }
        }
        const s = stats(readRecords(rt.archiveFile))
        const lines = [
          `档案：${rt.archiveFile}`,
          `总条数 ${s.total}｜平台 ${JSON.stringify(s.bySource)}｜跨度 ${s.days} 天`,
          `最后一次写入 ${s.lastWrite ?? '（还没有内容）'}`,
          `表情包策略：私聊「${settings.stickerPrivate === 'marker' ? '只记标记' : '存原图'}」· 群「${settings.stickerGroup === 'marker' ? '只记标记' : '存原图'}」`,
        ]
        if (status.lastPurge) lines.push(`上次清理：${status.lastPurge.until} 之前，删了 ${status.lastPurge.files} 个文件`)
        if (args?.verify) {
          const h = healthCheck(sessionsRoot, rt.archiveFile)
          lines.push(
            `原始会话 ${h.sessionsOnDisk} 个｜档案覆盖 ${h.sessionsInArchive} 个｜坏帧 ${h.badFrames}`,
            h.missing === 0 ? '核对通过：没有缺口。' : `发现缺口 ${h.missing} 条。`,
          )
          if (h.perSession.length) {
            lines.push(...h.perSession.slice(0, 10).map((p) => `- ${p.sessionId}: 缺 ${p.gap ?? '?'} 条`))
          }
        }
        return { ok: true, summary: lines.join('\n') }
      },
    }),
  )
}

/** 离线补每个会话的 cwd 和 QQ 会话 key，供实时判断平台与提问者身份。 */
function collectCwds(sessionsRoot, cwds, scopes) {
  try {
    for (const { file, sessionId } of listSessionFiles(sessionsRoot)) {
      try {
        const events = parseEvents(decodeMultiFrame(readFileSync(file)).text)
        const cwd = sessionCwd(events)
        if (cwd && !cwds.has(sessionId)) cwds.set(sessionId, cwd)
        if (scopes && !scopes.has(sessionId)) {
          for (const e of events) {
            if (e?.type !== 'user/message') continue
            const text = (e.data?.content ?? [])
              .filter((c) => c?.type === 'text')
              .map((c) => c.text)
              .join('')
            const scope = parseScopeKey(text)
            if (scope) {
              scopes.set(sessionId, scope)
              break
            }
          }
        }
      } catch {
        // 单个文件坏了不影响其它
      }
    }
  } catch {
    // 纯优化，失败就算了
  }
}
