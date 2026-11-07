window.__ModuleLoader__.load({
  id: 'dsh-conversations-archive',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const SEEN_KEY = 'dsh-conversations-archive:last-seen-activation'

    // 什么时候弹：
    //   · 插件不健康 → 每次都弹（这是唯一需要你立刻知道的）
    //   · 健康，且这次是「用户刚在插件页打开」→ 弹一次，记在 localStorage
    //   · 健康，且这次是「开机时加载」→ 不弹
    function pickNotice(status) {
      if (!status) return null
      if (status.ok === false) {
        return { kind: 'error', text: `对话档案室异常：${status.error ?? '未知原因'}` }
      }
      if (status.bootLoad) return null
      let seen = null
      try {
        seen = window.localStorage.getItem(SEEN_KEY)
      } catch {
        seen = null
      }
      if (seen === status.activationId) return null
      try {
        window.localStorage.setItem(SEEN_KEY, String(status.activationId))
      } catch {
        // 存不进去就每次都弹一次，可接受
      }
      return { kind: 'ok', text: `对话档案室已启用 · 已收录 ${status.total ?? 0} 条` }
    }

    function ArchiveToast() {
      const [notice, setNotice] = React.useState(null)
      const timerRef = React.useRef(null)
      const lastCheck = React.useRef(0)

      React.useEffect(() => {
        let alive = true

        const check = () => {
          lastCheck.current = Date.now()
          fetch('/api/conversations-archive/status', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((status) => {
              if (!alive) return
              const next = pickNotice(status)
              if (!next) return
              setNotice(next)
              if (timerRef.current) window.clearTimeout(timerRef.current)
              timerRef.current = window.setTimeout(() => {
                if (alive) setNotice(null)
              }, 6000)
            })
            .catch(() => {
              // 接口不可用（插件停用、或不是本 profile）：静默
            })
        }

        check()

        // 插件页拨开关时页面不会重新挂载，所以回到页面时再看一眼（5 秒内不重复）
        const onVisible = () => {
          if (document.visibilityState !== 'visible') return
          if (Date.now() - lastCheck.current < 5000) return
          check()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)

        return () => {
          alive = false
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
          if (timerRef.current) window.clearTimeout(timerRef.current)
        }
      }, [])

      if (!notice) return null
      const ok = notice.kind === 'ok'
      return h(
        'div',
        {
          role: 'status',
          onClick: () => setNotice(null),
          title: '点一下关闭',
          style: {
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--dsw-alias-bg-overlay, #1f1f22)',
            border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))',
            color: 'var(--dsw-alias-label-primary, #eeeeee)',
            boxShadow: '0 8px 24px rgba(0,0,0,.25)',
            fontSize: 13,
            lineHeight: 1.45,
            cursor: 'pointer',
            pointerEvents: 'auto',
            maxWidth: 360,
          },
        },
        h('span', {
          style: {
            width: 8,
            height: 8,
            borderRadius: '50%',
            flex: '0 0 auto',
            background: ok
              ? 'var(--dsw-alias-state-success-primary, #3fb950)'
              : 'var(--dsw-alias-state-error-primary, #f85149)',
          },
        }),
        notice.text,
      )
    }

    // ---------- 设置页（设置 → 对话档案室） ----------
    const C = {
      text: 'var(--dsw-alias-label-primary, #eeeeee)',
      sub: 'var(--dsw-alias-label-secondary, #a9a9b3)',
      border: 'var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
      accent: 'var(--dsw-alias-brand-primary, #4d8dff)',
      error: 'var(--dsw-alias-state-error-primary, #f85149)',
      ok: 'var(--dsw-alias-state-success-primary, #3fb950)',
    }
    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '14px 0',
      borderBottom: `1px solid ${C.border}`,
    }
    const inputStyle = {
      flex: '1 1 auto',
      minWidth: 0,
      padding: '8px 10px',
      borderRadius: 8,
      border: `1px solid ${C.border}`,
      background: 'transparent',
      color: C.text,
      fontSize: 13,
      fontFamily: 'inherit',
    }
    const buttonStyle = {
      padding: '8px 14px',
      borderRadius: 8,
      border: `1px solid ${C.border}`,
      background: 'transparent',
      color: C.text,
      fontSize: 13,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    function localInputValue(date) {
      const p = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`
    }

    function SettingsPage() {
      const [status, setStatus] = React.useState(null)
      const [dir, setDir] = React.useState('')
      const [priv, setPriv] = React.useState('file')
      const [group, setGroup] = React.useState('marker')
      const [enhance, setEnhance] = React.useState('off')
      const [continuity, setContinuity] = React.useState(false)
      const [biliNote, setBiliNote] = React.useState(false)
      const [antiDumb, setAntiDumb] = React.useState(false)
      const [until, setUntil] = React.useState(() => localInputValue(new Date()))
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)

      const loadStatus = React.useCallback(async () => {
        try {
          const res = await fetch('/api/conversations-archive/status', { cache: 'no-store' })
          if (!res.ok) return
          const s = await res.json()
          setStatus(s)
          if (s.archiveDir) setDir((current) => current || s.archiveDir)
          if (s.settings) {
            setPriv(s.settings.stickerPrivate ?? 'file')
            setGroup(s.settings.stickerGroup ?? 'marker')
            setEnhance(s.settings.qqEnhance ?? 'off')
            setContinuity(Boolean(s.settings.qqContinuity))
            setBiliNote(s.settings.biliDynamicNote === true)
            setAntiDumb(s.settings.antiDumbHint === true)
          }
        } catch {
          // 插件没起：保持安静
        }
      }, [])

      React.useEffect(() => {
        loadStatus()
      }, [loadStatus])

      const post = async (path, body) => {
        setBusy(true)
        setMsg(null)
        try {
          const res = await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || json.ok === false) {
            setMsg({ kind: 'error', text: json.error ?? `请求失败（${res.status}）` })
          } else {
            if (json.settings) {
              setPriv(json.settings.stickerPrivate)
              setGroup(json.settings.stickerGroup)
              setEnhance(json.settings.qqEnhance ?? 'off')
              setContinuity(Boolean(json.settings.qqContinuity))
              setBiliNote(json.settings.biliDynamicNote === true)
              setAntiDumb(json.settings.antiDumbHint === true)
              if (json.settings.archiveDir) setDir(json.settings.archiveDir)
            }
            if (json.summary) {
              const mb = (json.summary.bytes / 1024 / 1024).toFixed(1)
              setMsg({ kind: 'ok', text: `清理完成：删掉 ${json.summary.files} 个文件，省了 ${mb} MB` })
            } else {
              setMsg({ kind: 'ok', text: '已保存' })
            }
            loadStatus()
          }
        } catch (error) {
          setMsg({ kind: 'error', text: `请求失败：${error?.message ?? error}` })
        } finally {
          setBusy(false)
        }
      }

      const configured = Boolean(status?.configured)

      return h(
        'div',
        { style: { maxWidth: 640, color: C.text, fontSize: 14 } },
        h('h2', { style: { margin: '0 0 6px', fontSize: 18 } }, '对话档案室'),
        h(
          'p',
          { style: { margin: '0 0 18px', color: C.sub, fontSize: 13, lineHeight: 1.6 } },
          '把 DSH 窗口、QQ、B站 的对话只追加地存成纯文本。档案里的内容不会被改写或删除；清理动作只删图片文件。',
        ),

        !configured &&
          h(
            'div',
            {
              style: {
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${C.accent}`,
                marginBottom: 16,
                fontSize: 13,
                lineHeight: 1.6,
              },
            },
            '还没选择存放位置，现在不会收录任何对话。选一个目录并保存，就会开始收录并回补历史。',
          ),

        h(
          'div',
          { style: { ...rowStyle, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: '1 1 auto', minWidth: 0 } },
            h('div', null, '档案存放位置'),
            h('div', { style: { color: C.sub, fontSize: 12, marginTop: 4 } }, '换路径后，新路径从零开始收录，旧目录原样留着不动。'),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
              h('input', {
                style: inputStyle,
                value: dir,
                placeholder: '例如 D:\\dsh-archive',
                spellCheck: false,
                onChange: (e) => setDir(e.target.value),
              }),
            ),
          ),
        ),

        h(
          'div',
          { style: { ...rowStyle, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: '1 1 auto' } },
            h('div', null, '私聊表情包'),
            h('div', { style: { color: C.sub, fontSize: 12, marginTop: 4 } }, '关 = 存原图；开 = 只记一条标记，不存图。'),
          ),
          h('input', {
            type: 'checkbox',
            checked: priv === 'marker',
            style: { width: 18, height: 18, accentColor: C.accent, cursor: 'pointer' },
            onChange: (e) => setPriv(e.target.checked ? 'marker' : 'file'),
          }),
        ),

        h(
          'div',
          { style: { ...rowStyle, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: '1 1 auto' } },
            h('div', null, '群表情包'),
            h('div', { style: { color: C.sub, fontSize: 12, marginTop: 4 } }, '开 = 只记一条标记（默认）；关 = 存原图。'),
          ),
          h('input', {
            type: 'checkbox',
            checked: group === 'marker',
            style: { width: 18, height: 18, accentColor: C.accent, cursor: 'pointer' },
            onChange: (e) => setGroup(e.target.checked ? 'marker' : 'file'),
          }),
        ),

        h(
          'div',
          { style: { ...rowStyle, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: '1 1 auto' } },
            h('div', null, '增强模式（QQ / B站，实验）'),
            h(
              'div',
              { style: { color: C.sub, fontSize: 12, marginTop: 4, lineHeight: 1.6 } },
              'QQ：剪掉每次唤醒都塞进来的「B站记忆」「来源判断」，再从档案补最近几轮原话。',
              h('br'),
              'B站：在提到「四类动态」的提示后补一句——daily 已经关了，想发就用 share-dynamic，不发也算正常。',
              h('br'),
              '只观察 = 只写日志不改；开启 = 真的改写。认不出来就原样放行。',
            ),
          ),
          h(
            'select',
            {
              value: enhance,
              style: { ...inputStyle, flex: '0 0 auto', width: 110 },
              onChange: (e) => setEnhance(e.target.value),
            },
            h('option', { value: 'off' }, '关'),
            h('option', { value: 'observe' }, '只观察'),
            h('option', { value: 'on' }, '开启'),
          ),
        ),

        h(
          'div',
          { style: { ...rowStyle, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: '1 1 auto' } },
            h('div', null, '更完整的来龙去脉'),
            h(
              'div',
              { style: { color: C.sub, fontSize: 12, marginTop: 4, lineHeight: 1.6 } },
              '关（默认）= 每次补最近 8 轮、每条 60 字；开 = 补最近 20 轮、每条 150 字，并告诉她档案里能查全文。',
              h('br'),
              '开的代价是每次唤醒多一两千字 token。只在「QQ 增强模式」为开启时才有区别。',
            ),
          ),
          h('input', {
            type: 'checkbox',
            checked: continuity,
            style: { width: 18, height: 18, accentColor: C.accent, cursor: 'pointer' },
            onChange: (e) => setContinuity(e.target.checked),
          }),
        ),

        h(
          'div',
          { style: { ...rowStyle, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: '1 1 auto' } },
            h('div', null, 'B站 动态由她自己决定'),
            h(
              'div',
              { style: { color: C.sub, fontSize: 12, marginTop: 4, lineHeight: 1.6 } },
              '开 = 她醒来时补一句：四类动态已关，别再调 daily；想发就用 share-dynamic，不想发就不发。',
              h('br'),
              '默认关。这一项独立于上面的增强模式。',
            ),
          ),
          h('input', {
            type: 'checkbox',
            checked: biliNote,
            style: { width: 18, height: 18, accentColor: C.accent, cursor: 'pointer' },
            onChange: (e) => setBiliNote(e.target.checked),
          }),
        ),

        h(
          'div',
          { style: { ...rowStyle, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: '1 1 auto' } },
            h('div', null, '轻度防“降智”（B站）'),
            h(
              'div',
              { style: { color: C.sub, fontSize: 12, marginTop: 4, lineHeight: 1.6 } },
              '开 = 她每次醒来补三条省力习惯：旧事查档案别重读视频；看视频/评论少往对话里倒（--top 3、--no-frames）；收工把结论写进日记。',
              h('br'),
              '默认关。这只是提示，不是硬拦——真正的“少塞东西”还得改 surfcore。',
            ),
          ),
          h('input', {
            type: 'checkbox',
            checked: antiDumb,
            style: { width: 18, height: 18, accentColor: C.accent, cursor: 'pointer' },
            onChange: (e) => setAntiDumb(e.target.checked),
          }),
        ),

        h(
          'div',
          { style: { marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.border}` } },
          h('div', { style: { fontSize: 13 } }, '清理图片'),
          h(
            'div',
            { style: { color: C.sub, fontSize: 12, marginTop: 4, lineHeight: 1.6 } },
            '把截止时间（含）之前的图片文件删掉。档案记录不动，只删文件；以后查到这些条目就只剩文字。',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              type: 'datetime-local',
              value: until,
              style: { ...inputStyle, flex: '0 0 auto', width: 210 },
              onChange: (e) => setUntil(e.target.value),
            }),
            h(
              'button',
              {
                style: buttonStyle,
                disabled: busy,
                onClick: () => {
                  const target = new Date(until)
                  if (Number.isNaN(target.getTime())) {
                    setMsg({ kind: 'error', text: '时间点无效' })
                    return
                  }
                  post('/api/conversations-archive/purge', { until: target.getTime() })
                },
              },
              '清理到这个时间之前的图片',
            ),
          ),
        ),

        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 22, paddingTop: 14, borderTop: `1px solid ${C.border}` } },
          h(
            'button',
            {
              style: { ...buttonStyle, borderColor: C.accent, color: C.accent, padding: '9px 20px' },
              disabled: busy,
              onClick: () => post('/api/conversations-archive/settings', {
                archiveDir: dir.trim(),
                stickerPrivate: priv,
                stickerGroup: group,
                qqEnhance: enhance,
                qqContinuity: continuity,
                biliDynamicNote: biliNote,
                antiDumbHint: antiDumb,
              }),
            },
            busy ? '保存中…' : '保存设置',
          ),
        ),

        msg &&
          h(
            'div',
            { style: { marginTop: 12, fontSize: 13, color: msg.kind === 'error' ? C.error : C.ok } },
            msg.text,
          ),

        status &&
          h(
            'div',
            { style: { marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.border}`, color: C.sub, fontSize: 12, lineHeight: 1.7 } },
            h('div', null, `已收录 ${status.total ?? 0} 条｜平台 ${JSON.stringify(status.bySource ?? {})}`),
            h('div', null, `最后写入 ${status.lastWrite ?? '（还没有内容）'}`),
            status.lastPurge && h('div', null, `上次清理 ${status.lastPurge.until}｜删了 ${status.lastPurge.files} 个文件`),
          ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'conversations-archive-toast', order: 60 },
            ArchiveToast,
          ),
        )
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'conversations-archive', order: 60, label: '对话档案室' },
            SettingsPage,
          ),
        )
      },
    }
  },
})
