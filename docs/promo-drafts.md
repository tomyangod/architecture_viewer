# 0.8.0 推广文案草稿

> 三个渠道语气不同：HN 技术向、反营销；掘金教程向、痛点叙事；v2ex 简短、朋友式分享。
> 发布前替换链接、核对版本号与截图。

---

## 1. Hacker News — Show HN（英文）

**标题**：Show HN: Architecture Viewer – see what changed in your architecture after an AI coding session

**正文**：

Hi HN,

After a long AI coding session (Cursor/Copilot/Trae), I often couldn't answer a simple question before merging: what actually changed in the architecture? Which widely-imported type got deleted? Did a controller just reach straight into storage? What new third-party packages came in? And whose code is going to break?

So I built Architecture Viewer (Apache-2.0, offline, no LLM required):

- `npx arch-viewer session start` before the AI touches code → records a structural baseline (tree-sitter graph: JS/TS/Vue/Svelte/Python/Go/Java)
- `npx arch-viewer session report` after the session → Before/After diff with risk findings (cross-layer violations, layer skips, removed types with downstream counts, new external deps, high-fanout changes) plus reverse-dependency impact analysis (BFS over import/extends/implements/calls edges, union of base+head reverse edges, change-cluster piercing)
- A GitHub Action posts the same thing as a PR comment automatically, and it edits its own comment on each push instead of spamming
- A VS Code extension shows a status-bar badge that turns red on high risk, with the report in a webview

It's deterministic static analysis — no API key, runs in CI. High-risk exits with code 1, so it slots into AI coding workflow rules as a merge gate.

Repo: https://github.com/heyangyan/architecture_viewer (mirror; primary on Gitee)
Landing page: open `landing-new.html` in the repo, or the README walkthrough.

Curious about two things: (1) how do you currently review AI-generated PRs for architectural drift? (2) what signals would make a diff comment trustworthy vs noise to you?

---

## 2. 掘金（中文，教程向）

**标题**：AI 改了 30 个文件后，我用一条命令看清架构到底变了什么

**正文框架**：

1. **痛点开场**：Cursor 会话两小时，diff 几百行，AI 说「重构完成」。你敢直接合吗？
   删了哪个被 5 个模块引用的类？controller 是不是直连了数据库？顺手装的 lodash 谁批准的？
   代码 review 能看逻辑，架构层面的变化全靠肉眼记忆。

2. **解法**：Architecture Viewer——AI 动手前记基线，动手后出对比：
   ```bash
   npx arch-viewer session start    # 改之前
   # ……AI 写代码……
   npx arch-viewer session report   # 改之后：变更图谱 + 风险分级 + 影响面
   ```
   - tree-sitter 结构解析（JS/TS/Vue/Svelte/Python/Go/Java），不依赖 LLM，秒级、离线
   - 风险发现：跨层违规 / 层级穿透 / 类型删除（按下游数升降级）/ 新外部依赖 / 高扇出
   - 影响面：反向依赖 BFS，告诉你「这次改动会波及谁」，穿透互相依赖的改动簇
   - 高风险 exit 1，可直接写进 AI 工作流规则当验收门

3. **三种用法截图位**：
   - CLI 会话门（终端报告 + HTML Before/After 图谱）
   - VS Code 扩展状态栏角标（🟢🟠🔴，点角标看报告）
   - GitHub PR 自动评论（每个 PR 贴架构影响面，push 只更新不刷屏）——附工作流 yaml

4. **实战 demo**：贴一个真实小例子（删除 UserService → 影响 UserController/BillingJob → 🔴 评论）。

5. **结尾**：开源 Apache-2.0，30 秒上手：`npx arch-viewer session start .`
   仓库链接 + landing 页链接。欢迎 issue 反馈误报。

**标签**：AI编程 / 架构 / 代码审查 / 开源 / GitHub Actions

---

## 3. V2EX（中文，分享节点风格）

**标题**：[开源] 做了个 AI 编码会话后的架构变更验收工具，求拍砖

**正文**：

各位好，撸了个小工具解决自己的痛点：用 Cursor/Trae 让 AI 改完代码后，合入前总说不清架构变了啥——删了哪个被广泛引用的类型、有没有跨层调用、新加了什么依赖、会波及谁。

用法就三步：

```
npx arch-viewer session start   # 让 AI 改之前
npx arch-viewer session report  # 改完之后看报告
npx arch-viewer session start   # 确认没问题，刷新基线
```

- tree-sitter 静态分析，支持 JS/TS/Vue/Svelte/Python/Go/Java，不要 API Key，离线秒出
- 风险分级：跨层违规、层级穿透、类型删除（按下游客数定级）、新外部依赖等
- 影响面分析：反向依赖追踪，直接告诉你谁会被这次改动波及
- 附带 VS Code 扩展（状态栏红绿灯角标）和 GitHub Action（PR 自动贴架构评论，重复 push 只更新不刷屏）

Apache-2.0 开源，文档和 landing 页都在仓库里：
https://gitee.com/heyangyan/architecture_viewer

想听听大家的意见：你们 review AI 生成的 PR 时，架构层面的变化都怎么把关？这种评论在 PR 里你们会觉得有用还是噪音？

---

## 发布检查清单

- [ ] 版本号 0.8.0 已发布（npm publish / vsce publish / tag）
- [ ] Release 页上传 arch-viewer.vsix
- [ ] 各渠道链接可访问（仓库公开、landing 页可开）
- [ ] HN 用 GitHub mirror 链接（HN 受众习惯）
- [ ] 掘金配 3 张截图（终端报告 / 扩展角标 / PR 评论）
- [ ] 发布后 48 小时内把评论区反馈录入 docs/feedback-tracking.md
