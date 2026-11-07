# 发布清单

这份目录就是可以发布的包。下面是从零到上架的完整步骤，按顺序做。

## 0. 发布前最后确认

- [ ] `package.json` 里的 `name` 是 `dsh-conversations-archive`（npm 上目前没被占用）
- [ ] `version` 是 `0.1.4`；**每次改动后必须升版本号**，npm 不接受重复版本
- [ ] `engines.dsh` 与你实际验证过的 DSH 版本一致（现在是 `>=0.2.1-rc.5 <0.3.0`）
- [ ] 没有个人数据：QQ 号、B站 UID 已清空；路径默认是空的，由用户自己选

## 1. 推到 GitHub

```bash
cd 档案室插件打包
git init
git add .
git commit -m "feat: conversations archive plugin for DeepSeek Harness"
git branch -M main
git remote add origin https://github.com/axdfczbh/dsh-conversations-archive.git
git push -u origin main
```

推完之后，回到 `package.json` 补上这两项（npm 会读它们）：

```json
"repository": { "type": "git", "url": "https://github.com/axdfczbh/dsh-conversations-archive" },
"homepage": "https://github.com/axdfczbh/dsh-conversations-archive#readme"
```

## 2. 发到 npm

```bash
npm login
npm publish --access public
```

注意：`package.json` 里**不要** `"private": true`（这份已经去掉了）。

发完验证：

```bash
npm view dsh-conversations-archive version
```

## 3. 装回来验证

```bash
dsh plugin add dsh-conversations-archive
```

装好后打开「设置 → 对话档案室」，选一个目录，确认：

- [ ] 设置页能开、能存
- [ ] 选完目录后 `conversations.jsonl` 开始出现内容
- [ ] 工具列表里能看到 `search_conversations` 和 `archive_health`
- [ ] 用一句旧话里的短语能搜到

## 4. 上插件市场（Discover 页）

市场读的是 `https://dshopen.org/index.json`，只有列进索引才会出现在 Discover 里。GitHub 上架不会自动进去。

需要提一个索引条目，字段照这个填：

```json
{
  "name": "dsh-conversations-archive",
  "title": { "en": "Conversations Archive", "zh": "对话档案室" },
  "description": {
    "en": "Append-only plain-text archive of DSH, QQ and Bilibili conversations, searchable by keyword and date.",
    "zh": "把 DSH、QQ、B站 的对话只追加地存成纯文本档案，可按关键词和时间检索。"
  },
  "repository": { "url": "https://github.com/axdfczbh/dsh-conversations-archive" },
  "metadata": { "category": "memory", "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "archive", "conversation", "memory"] },
  "versions": [
    {
      "version": "0.1.4",
      "publishTimestamp": <npm 发布时的 unix 秒>,
      "source": { "type": "npm", "registry": "https://registry.npmjs.org/" },
      "engines": { "dsh": ">=0.2.1-rc.5 <0.3.0" }
    }
  ]
}
```

提交方式通常是给索引仓库提 PR，或者按 dshopen.org 页面上的收录说明走。

## 5. 发布后要补的

- [ ] 在 README 顶部加一句实际安装命令（有 npm 之后可以写 `dsh plugin add`）
- [ ] 给 GitHub 仓库加 topics：`dsh`、`dsh-plugin`、`deepseek-harness`
- [ ] 打 tag：`git tag v0.1.4 && git push --tags`
