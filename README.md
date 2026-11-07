# Conversations Archive · 对话档案室

> **想法与需求来自 axdfczbh；实现由他电脑上运行的 DeepSeek 完成。**
> **Idea and requirements by axdfczbh; implemented by the DeepSeek agent running on his machine.**
> 详见 [关于作者与 AI 参与](#ai-disclosure) / [About authorship and AI](#ai-disclosure).

An append-only plain-text archive of everything you and an agent said — in DSH sessions, on QQ, and on Bilibili — plus a `search_conversations` tool so any window can look up what was said, when, and where.

The point is not a prettier history view. The point is that a fresh window can answer "what did we decide last week?" by **reading the record**, instead of guessing from a decaying memory card.

**[English](#english) · [中文](#中文)**

---

<a id="english"></a>
## English

### What it does

- **Captures live.** Subscribes to `session/event` and appends each real utterance the moment it is written. Nothing is summarized, nothing is rewritten.
- **Backfills once.** Every existing session log is decoded (multi-frame zstd) and merged into the archive. Idempotent: the key is `session id + event seq`, so re-running adds nothing.
- **Redacts on the way in.** Tokens, cookies, passwords, bearer credentials, e-mails and phone numbers are replaced before anything is written to disk.
- **Labels every record.** Source (`dsh` / `qq` / `bili`), window title, role, and a sensitivity flag (`private` / `normal`).
- **Searches.** `search_conversations(query, since?, until?, limit?, source?)` scores by keyword hits, returns time + window + session id, and rewrites private rows to "content withheld" when the caller is not the owner.
- **Keeps media references.** QQ stickers and images are recorded as a marker plus metadata; the image itself can be saved next to the archive and purged later by date.
- **Stays out of the prompt.** Nothing is injected into system prompts. The tool is the only door.

### Requirements

- DeepSeek Harness `0.2.1-rc.5` or newer (declared via `engines.dsh`).
- Node.js 22+ (uses `zlib.zstdDecompressSync`).
- Any OS where the session directory is readable. Paths are configurable.

### Install

```bash
# straight from GitHub
dsh plugin add github:axdfczbh/dsh-conversations-archive

# or from a local checkout
dsh plugin add /absolute/path/to/dsh-conversations-archive
```

Then open **Settings → Conversations Archive** and pick a directory. **Nothing is collected until a directory is chosen** — that is deliberate: the plugin must not write into a path you did not approve.

### Platform support

The plugin is not tied to one vendor — it recognises *tool calls*, not products. But that recognition is what decides whether QQ and Bilibili rows appear at all.

| Source | Works out of the box? | What it needs |
|---|---|---|
| DSH sessions | **Yes** | Nothing. Every window is an ordinary session; all it needs is a readable session directory. |
| QQ | Needs a matching bridge | Tool names from the SnowLuma QQ bridge: `qq_send_message`, `qq_send_private_message`, `qq_send_group_message`, `qq_reply`, `qq_send_sticker`, `qq_wait_for_messages`, `qq_get_unread_messages`, `qq_get_recent_messages`, `qq_get_message_images`, `qq_collect_sticker`, plus their JSON shapes. |
| Bilibili | Needs SurfCore's `bili.mjs` | A session whose cwd is under `surfcore/state/bili-agents`, and publishing done through `pwsh` calls to `bili.mjs` (`daily` / `comment` / `dm` / `reply` / `share-dynamic`). |

**If your bridge does not match, nothing breaks.** The platform-specific rows are simply not produced. The conversation itself is still archived in full with `source: "dsh"` — you lose the platform-side view, not the transcript.

To adapt another bridge, add a case to `lib/platform.mjs` (`recordsFromCall` / `recordsFromResult`). If its session directory differs, also extend `platformOf()` in `lib/privacy.mjs` (and the copies in `lib/extract.mjs` / `lib/platform.mjs`).

### Settings

| Setting | Default | Meaning |
|---|---|---|
| Archive directory | *(empty)* | Where `conversations.jsonl`, `status.json` and `media/` live. Changing it starts a fresh archive at the new path; the old directory is left untouched. |
| Private-chat stickers | keep files | Off = download the sticker image; On = record a marker only. |
| Group stickers | marker only | On = marker only; Off = download. |
| Enhance mode (QQ / Bilibili) | off | Experimental prompt-shaping below. |
| Fuller continuity | off | 20 rounds × 150 chars instead of 8 × 60, plus a pointer to the archive. |
| Light anti-bloat hints (Bilibili) | off | Appends three habits to Bilibili wakes. |
| Purge images before | — | Deletes image files older than the chosen time. Archive rows are never rewritten. |

### Enhance mode (optional, off by default)

Two switches let the plugin edit the **message about to be sent to the model** — never the stored log:

- **QQ**: trims the large boilerplate blocks (`Bilibili memory`, `source judgement`) from a wake prompt and appends the last few rounds from the archive.
- **Bilibili**: appends a short note plus (optionally) three habits that keep context from bloating.

Both degrade silently: if the surrounding text stops matching, the message is passed through unchanged. Start in **observe** mode, read `~/.dsh/conversations-archive/enhance-log.jsonl`, then switch to **on**.

### Privacy model

- `private` rows are DSH conversations and QQ private chats. They are returned in full only when the caller is the owner — determined structurally (session cwd + the QQ conversation key in the wake prompt), not by asking the model.
- From a group or Bilibili caller, private rows come back as time + "content withheld". The model never receives the text, so it cannot leak it.
- Owner QQ id and Bilibili UID are empty by default; set them in `~/.dsh/conversations-archive/settings.json`.

### The archive format

One JSON object per line, append-only:

```json
{"id":"session-…:512","sessionId":"session-…","seq":512,"time":1794050649852,
 "source":"dsh","role":"assistant","sensitivity":"private","text":"…"}
```

`id` is the deduplication key. Re-running the backfill after a crash, or capturing the same event twice, never produces a second row.

### Known limitations

- QQ and Bilibili capture depends on how those platform agents call their tools. It is built against SurfCore's `bili.mjs` / SnowLuma QQ toolset; other bridges may need an adapter in `lib/platform.mjs`.
- Media download depends on the URL still being alive at capture time.
- Text surgery in enhance mode is format-sensitive by nature. It fails open, never closed.

### License

MIT. See [LICENSE](LICENSE).

---

<a id="中文"></a>
## 中文

### 它做什么

- **实时收录**：订阅 `session/event`，每句真话落地那一刻就追加一行。不做摘要，不改原文。
- **一次性回补**：已有的会话日志（多帧 zstd）全部解码并入档案；去重键是「会话 id + 事件序号」，重复跑不产生重复行。
- **进库前脱敏**：token、cookie、密码、Bearer 凭据、邮箱、手机号在写盘之前就替换掉。
- **每条带标记**：来源（dsh / qq / bili）、窗口名、角色、以及敏感度（私事 / 普通）。
- **可检索**：`search_conversations(query, since?, until?, limit?, source?)`，按关键词命中数排序，返回时间、窗口、会话 id。
- **图片留线索**：QQ 表情和图片记成「标记 + 元数据」，原图可以存在档案旁边，也能按日期清理。
- **不碰提示词**：不往系统提示里注入任何东西，工具是唯一的入口。

### 环境要求

- DeepSeek Harness `0.2.1-rc.5` 或更新（写在 `engines.dsh` 里）。
- Node.js 22+（用到 `zlib.zstdDecompressSync`）。
- 能读到会话目录的系统都行，路径可配。

### 安装

```bash
# 直接从 GitHub 装
dsh plugin add github:axdfczbh/dsh-conversations-archive

# 或本地目录
dsh plugin add /绝对路径/dsh-conversations-archive
```

然后打开 **设置 → 对话档案室**，先选一个存放目录。**在选定目录之前不会收录任何东西**——这是故意的，插件不该往你没批准过的路径里写文件。

### 平台支持

这个插件不绑定某一个产品——它识别的是**工具调用**。但识别得到与否，决定了 QQ 和 B站 那两部分记录会不会出现。

| 来源 | 开箱可用？ | 需要什么 |
|---|---|---|
| DSH 会话 | **是** | 什么都不用。每个窗口都是普通会话，只要会话目录读得到。 |
| QQ | 需要匹配的桥接 | SnowLuma QQ 桥接的工具名：`qq_send_message`、`qq_send_private_message`、`qq_send_group_message`、`qq_reply`、`qq_send_sticker`、`qq_wait_for_messages`、`qq_get_unread_messages`、`qq_get_recent_messages`、`qq_get_message_images`、`qq_collect_sticker`，以及它们返回的 JSON 结构。 |
| B站 | 需要 SurfCore 的 `bili.mjs` | 会话 cwd 在 `surfcore/state/bili-agents` 下，并且发布/回复走的是 `pwsh` 调 `bili.mjs`（`daily` / `comment` / `dm` / `reply` / `share-dynamic`）。 |

**桥接对不上也不会坏。** 平台那部分记录不产生而已；对话本身照样完整进档案，标成 `source: "dsh"`——你丢的是平台视角，不是对话记录。

要适配别的桥接，在 `lib/platform.mjs` 里加一个分支（`recordsFromCall` / `recordsFromResult`）；如果它的会话目录不一样，再把 `platformOf()` 补上（`lib/privacy.mjs`，以及 `lib/extract.mjs` / `lib/platform.mjs` 里的同名副本）。

### 设置项

| 项目 | 默认 | 说明 |
|---|---|---|
| 档案存放位置 | 空 | `conversations.jsonl`、`status.json`、`media/` 都在这里。换路径后新路径从零开始，旧目录原样留着。 |
| 私聊表情包 | 存原图 | 开 = 只记标记，不存图。 |
| 群表情包 | 只记标记 | 关 = 存原图。 |
| 增强模式（QQ / B站） | 关 | 见下。 |
| 更完整的来龙去脉 | 关 | 从 8 轮 × 60 字加到 20 轮 × 150 字，并附一句「档案里能查」。 |
| 轻度防「降智」（B站） | 关 | 给 B站 唤醒补三条省力习惯。 |
| 清理截止时间 | — | 删掉这个时间之前的图片文件；档案记录不改写。 |

### 增强模式（可选，默认关）

它会在**消息送去模型之前**改那份要发出去的内容，磁盘上的日志一个字不动：

- **QQ**：剪掉唤醒提示里「B站记忆」「来源判断」两块，再从档案补最近几轮原话。
- **B站**：在提到动态的提示后补一句说明；打开「轻度防降智」时再多三条习惯。

两者认不出来就原样放行，只降级、不报错。建议先用「只观察」跑一天，看 `~/.dsh/conversations-archive/enhance-log.jsonl` 记了什么，再切「开启」。

### 隐私模型

- `私事` = DSH 会话 + QQ 私聊。只有主人本人来问才给全文。
- 「谁在问」由结构判断：会话的工作目录，加上 QQ 唤醒提示里的会话 key，**不靠模型自报**。
- 从群或 B站 这类公开场调用时，私事条目只返回时间和「内容不展示」；正文在程序里就被截掉，模型手里根本没有。
- 主人的 QQ 号和 B站 UID 默认留空，需要时写进 `~/.dsh/conversations-archive/settings.json`。

### 档案格式

一行一个 JSON，只追加：

```json
{"id":"session-…:512","sessionId":"session-…","seq":512,"time":1794050649852,
 "source":"dsh","role":"assistant","sensitivity":"private","text":"…"}
```

`id` 就是去重键。崩溃后重跑回补，或者同一个事件被抓了两次，都不会多出一行。

### 已知限制

- QQ 和 B站 的解析依赖那两个平台 agent 怎么调工具。目前是按 SurfCore 的 `bili.mjs` 和 SnowLuma 的 QQ 工具集写的，换别的桥接需要在 `lib/platform.mjs` 里加适配。
- 图片能不能存下来，取决于抓取时链接还活着。
- 增强模式做的是文本手术，天生对格式敏感；它的失败方式是「原样放行」，不会弄坏会话。

### 许可证

MIT，见 [LICENSE](LICENSE)。

---

<a id="ai-disclosure"></a>
## 关于作者与 AI 参与 · About authorship and AI

**中文**

- **想法、需求、取舍**：axdfczbh。
- **代码**：由他电脑上运行的 DeepSeek agent 编写，逐轮迭代；每一版都在他的机器上真实跑过，不是一次性生成的。
- **验证**：功能由他用真实对话测试——包括故意给错的输入、真实的表情包、真实的私信。发现问题由他描述，agent 定位并修复。
- **责任**：仓库、账号、发布与维护都归 axdfczbh。AI 不持有凭据、不能推送代码，也没有任何未经他确认的提交。
- **所以**：这是一个「人提要求、AI 执行、人验收」的作品。如果你遇到 bug，那是这条链上还有缝，提 issue 就行。

**English**

- **Idea, requirements, trade-offs**: axdfczbh.
- **Code**: written by the DeepSeek agent running on his machine, across many rounds; every version was actually exercised on that machine, not generated in one shot.
- **Verification**: each feature was tested against real conversations — including deliberately wrong input, real stickers, real direct messages. He described what broke; the agent located and fixed it.
- **Responsibility**: the repository, the accounts, publishing and maintenance belong to axdfczbh. The agent holds no credentials, cannot push, and made no commit that he did not approve.
- **In short**: a human asked, an agent executed, the human accepted. If you hit a bug, that is a seam in that chain — open an issue.
