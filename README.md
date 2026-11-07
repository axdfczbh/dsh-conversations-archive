# Conversations Archive for DeepSeek Harness

An append-only plain-text archive of everything you and an agent said — in DSH sessions, on QQ, and on Bilibili — plus a `search_conversations` tool so any agent window can look up what was said, when, and where.

The point is not a prettier history view. The point is that a fresh window can answer "what did we decide last week?" by **reading the record**, instead of guessing from a decaying memory card.

[中文说明](README.zh.md)

## What it does

- **Captures live.** Subscribes to `session/event` and appends each real utterance the moment it is written. Nothing is summarized, nothing is rewritten.
- **Backfills once.** Every existing session log is decoded (multi-frame zstd) and merged into the archive. Idempotent: the key is `session id + event seq`, so re-running adds nothing.
- **Redacts on the way in.** Tokens, cookies, passwords, bearer credentials, e-mails and phone numbers are replaced before anything is written to disk.
- **Labels every record.** Source (`dsh` / `qq` / `bili`), window title, role, and a sensitivity flag (`private` / `normal`).
- **Searches.** `search_conversations(query, since?, until?, limit?, source?)` scores by keyword hits, returns time + window + session id, and rewrites private rows to "content withheld" when the caller is not the owner.
- **Keeps media references.** QQ stickers and images are recorded as a marker plus metadata; the image itself can be saved next to the archive and purged later by date.
- **Stays out of the prompt.** Nothing is injected into system prompts. The tool is the only door.

## Requirements

- DeepSeek Harness `0.2.1-rc.5` or newer (declared via `engines.dsh`).
- Node.js 22+ (uses `zlib.zstdDecompressSync`).
- Windows or any OS where the session directory is readable. Paths are configurable.

## Install

```bash
# from a local checkout
dsh plugin add /absolute/path/to/dsh-conversations-archive

# or, once published to npm
dsh plugin add dsh-conversations-archive
```

Then open **Settings → Conversations Archive** and pick a directory. **Nothing is collected until a directory is chosen** — that is deliberate: the plugin must not write into a path you did not approve.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Archive directory | *(empty)* | Where `conversations.jsonl`, `status.json` and `media/` live. Changing it starts a fresh archive at the new path; the old directory is left untouched. |
| Private-chat stickers | keep files | Off = download the sticker image; On = record a marker only. |
| Group stickers | marker only | On = marker only; Off = download. |
| Enhance mode (QQ / Bilibili) | off | Experimental prompt-shaping below. |
| Fuller continuity | off | 20 rounds × 150 chars instead of 8 × 60, plus a pointer to the archive. |
| Light anti-bloat hints (Bilibili) | off | Appends three habits to Bilibili wakes. |
| Purge images before | — | Deletes image files older than the chosen time. Archive rows are never rewritten. |

## Enhance mode (optional, off by default)

Two switches let the plugin edit the **message about to be sent to the model** — never the stored log:

- **QQ**: trims the large boilerplate blocks (`Bilibili memory`, `source judgement`) from a wake prompt and appends the last few rounds from the archive.
- **Bilibili**: appends a short note plus (optionally) three habits that keep context from bloating.

Both degrade silently: if the surrounding text stops matching, the message is passed through unchanged. Start in **observe** mode, read `~/.dsh/conversations-archive/enhance-log.jsonl`, then switch to **on**.

## Privacy model

- `private` rows are DSH conversations and QQ private chats. They are returned in full only when the caller is the owner — determined structurally (session cwd + the QQ conversation key in the wake prompt), not by asking the model.
- From a group or Bilibili caller, private rows come back as time + "content withheld". The model never receives the text, so it cannot leak it.
- Owner QQ id and Bilibili UID are empty by default; set them in `~/.dsh/conversations-archive/settings.json`.

## The archive format

One JSON object per line, append-only:

```json
{"id":"session-…:512","sessionId":"session-…","seq":512,"time":1794050649852,
 "source":"dsh","role":"assistant","sensitivity":"private","text":"…"}
```

`id` is the deduplication key. Re-running the backfill after a crash, or capturing the same event twice, never produces a second row.

## Known limitations

- QQ and Bilibili capture depends on how those platform agents call their tools. It is built against SurfCore's `bili.mjs` / SnowLuma QQ toolset; other bridges may need an adapter in `lib/platform.mjs`.
- Media download depends on the URL still being alive at capture time.
- Text surgery in enhance mode is format-sensitive by nature. It fails open, never closed.

## License

MIT. See [LICENSE](LICENSE).
