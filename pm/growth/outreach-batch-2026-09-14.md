# 触达批次包：12 条待发（2026-09-14 晚）

> 目标：今晚–明早全部发出。口径基准见 [outreach-kit.md](outreach-kit.md) §0；发一条、登记一条（[seed-users.md](seed-users.md) 漏斗 + [p1-leads-2026-09-12.md](p1-leads-2026-09-12.md) 状态列）。
> 版本：`arch-viewer@0.12.2-rc.4`（npm `next`；若 rc.4 发布受阻，用 rc.3 亦可——核心验收链路两版一致）。
> 纪律：只发个性化消息；拒绝即止；已触达历史名单勿重复刷。

---

## A 组 · 掘金私信（6 条，模板 B，换引子即可发）

**发送位置：目标文章页 → 关注作者 → 私信（或评论区礼貌回复后私信）**
> 注意：#1–#6 软评已于 09-13 发过；本批是**作者私信**增量，勿再刷同文公开评论。Reddit C 组此前已跳过，默认不发。

### A1 · 「AI写代码不难，难的是不破坏架构」
URL: https://juejin.cn/post/7675242010802733108

```text
你好，看了你写的《AI写代码不难，难的是不破坏架构》，其中「局部正确、全局失控」这个说法很有共鸣——单文件都能过 review，拼起来跨层了没人知道。

我在验证开源工具 Architecture Viewer：AI 改完后对照 git HEAD，自动列出本轮新增的跨层依赖、被删类型和影响面；本地离线运行，钉 arch-viewer@0.12.2-rc.4，不替代测试与人工评审。

想先约 15 分钟，听你讲最近一次这类问题怎么发现的、花了多久；合适再谈两周本地试点（不要私码/PAT）。报名：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
```

### A2 · SDD/分层约束
URL: https://juejin.cn/post/7621551215504556075

```text
你好，看了你写的《告别 Vibe Coding：用 SDD 让 AI 编程提效 50%，三工具实战对比》，其中跨库约束、Controller 不写业务这条分层纪律很有共鸣——规则写在文档里，AI 一轮改动就可能悄悄打破。

我在验证开源工具 Architecture Viewer：AI 改完后对照 git HEAD，检查本轮有没有新增跨层依赖、破坏分层；每条结论带文件路径和依赖链可人工复核，本地离线，钉 arch-viewer@0.12.2-rc.4。

想先约 15 分钟听你讲：你们现在靠什么拦这类问题（CI？人工？）；合适再谈两周本地试点（不要私码/PAT）。报名：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
```

### A3 · Prompt→Spec「MUST NOT 擅自新增分层」
URL: https://juejin.cn/post/7651954728704376838

```text
你好，看了你写的《从 Prompt 到 Spec：一套通用 AI 编码规范工程化落地方法论》，其中「Prompt 里写 MUST NOT，Agent 仍然擅自新增分层」这个痛点太真实了——指令约束不住模型，最后还是靠人翻 diff。

我在验证开源工具 Architecture Viewer：不改提示词，AI 改完后对照 git HEAD 出结构结论——新增了哪些跨层依赖、谁被波及；本地离线、不连服务器，钉 arch-viewer@0.12.2-rc.4。

想约 15 分钟听你讲那次擅自分层后来怎么收场的；合适再谈两周本地试点（不要私码/PAT）。报名：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
```

### A4 · OpenSpec 实现与 specs 漂移
URL: https://juejin.cn/post/7648157267779321871

```text
你好，看了你写的《OpenSpec规约编程实践》，其中「实现与 specs 漂移检测」的思路很有共鸣——spec 有了，但每次合入前没人逐条核对实现还符合不符合。

我在验证开源工具 Architecture Viewer，走的是相邻半步：对照 git HEAD 检查本轮代码的结构事实（新增跨层依赖、删除的类型、影响面），每条附依赖链可复核；本地离线，钉 arch-viewer@0.12.2-rc.4。

想约 15 分钟聊聊：你们的 spec 漂移目前靠什么发现？合适再谈两周本地试点（不要私码/PAT）。报名：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
```

### A5 · Ask→Plan→Agent 后仍缺结构验收
URL: https://juejin.cn/post/7658998681744605219

```text
你好，看了你写的《Cursor 四模式选型指南：Ask / Plan / Agent / Debug 何时用哪个？》，其中「Ask→Plan→Agent 都上了，合入前还是没人说得清架构变了什么」这个判断很准——规划环节补齐了，验收环节还是空的。

我在验证开源工具 Architecture Viewer：AI 改完后对照 git HEAD 出一份结构验收结论（红/绿灯 + 本轮跨层依赖、影响面清单），在对话里 3 行看完，本地离线，钉 arch-viewer@0.12.2-rc.4。

想约 15 分钟听你讲最近一次大改动靠什么确认没破坏结构；合适再谈两周本地试点（不要私码/PAT）。报名：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
```

### A6 · AI 交付质量体系缺结构门
URL: https://juejin.cn/post/7623711769807634483

```text
你好，看了你写的《为了交付一个AI辅助开发的项目，我们搭了一套质量保障体系》，其中「AI 交付质量体系里缺一道结构门」的观点很有共鸣——测试管功能、lint 管风格，结构（分层、依赖方向）恰恰没人管。

我在验证开源工具 Architecture Viewer：AI 改完后对照 git HEAD 检查跨层依赖与影响面，红灯只亮在本轮相关的变化上，噪音低，可挂在 CI 也可在会话里直接看，本地离线，钉 arch-viewer@0.12.2-rc.4。

想约 15 分钟聊聊你们的交付流水线里这道门打算放哪；合适再谈两周本地试点（不要私码/PAT）。报名：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
```

---

## B 组 · GitHub 触达（3 条，模板 A）

**发送位置：目标仓库 issue/讨论，或维护者邮箱/个人主页联系方式**

### B1 · Graphenium（同类工具作者，互补访谈优先）

```text
Hi [维护者名]，I came across Graphenium while surveying tools that guard architecture against AI-generated changes — impressive overlap in intent (blocking cross-layer violations / drift).

I'm building Architecture Viewer (open source, Apache-2.0): after an AI coding session it diffs the dependency graph against git HEAD and reports only this-round structural changes (new cross-layer edges, deleted types, blast radius), with file-path evidence for every finding. Fully local/offline.

Not pitching a swap — I'd genuinely value 15 minutes comparing notes: which checks your users actually keep enabled, where the false positives bite hardest. Happy to share our pilot data (46% initial FP rate, root-caused to vendored dirs) in return.
```

### B2 · Yggdrasil（「Agent 读了规则仍跳过」亲历者）

```text
Hi [维护者名]，I read about your experience where the agent read the rules and still skipped them (hexagonal / repository pattern for DB access) — that exact failure mode is why I stopped relying on prompts.

I built Architecture Viewer (open source, Apache-2.0): it doesn't ask the agent to obey; it checks the diff after the fact against git HEAD — new cross-layer dependencies, deleted types, impact radius, each with verifiable evidence chains. Local and offline, works as an MCP tool or CI gate.

Would you have 15 minutes to walk me through how that incident was eventually caught? If it resonates, I'm piloting with 2 teams (free, no PAT, no code leaves your machine).
```

### B3 · archcodex（结构约束 + CI，问并用）

```text
Hi [维护者名]，saw archcodex's approach to structural constraints + CI enforcement — close to what dependency-cruiser does for JS, and a natural pre-commit gate.

I'm curious whether your users pair it with a "what changed this round" view: I maintain Architecture Viewer (open source), which diffs the dependency graph against git HEAD per AI session and reports only this-round structural changes with evidence chains. Wondering if the two compose well — constraint rules for policy, session diff for review.

15 minutes to compare notes? Also recruiting 2 pilot teams (free, local-only) if you know users who'd fit.
```

---

## C 组 · Reddit（3 条，英文，需先养号再发）

**前置：Reddit 账号需有基础 karma，新号直接发链接易被自动过滤。回复评论比发帖安全。**

### C1 · r/cursor「Architectural drift in AI-assisted development — how do you stop it?」

```text
We hit this too. What actually worked: stop asking the agent to behave, verify after the fact. I open-sourced a tool (Architecture Viewer) that diffs the dependency graph against git HEAD after each session — new cross-layer edges, deleted types, blast radius, each finding with a file-path evidence chain. Runs locally, no code upload, can gate the commit. Not a silver bullet (it checks structure, not business logic) but it catches the "looked fine file-by-file, broke the layering" class. Happy to share the red/green sample if useful.
```

### C2 · r/cursor「40%→92% architectural compliance」

```text
Congrats on 40→92 — pre/post generation constraints plus CI is the right shape. One thing we added on the review side: a per-session diff of the dependency graph vs git HEAD (only this-round changes: new cross-layer deps, deleted types, impact radius), so the reviewer sees "what structurally changed" in 3 lines instead of re-deriving it from the diff. It's open source (Architecture Viewer, local-only). Curious what your remaining 8% looks like — for us it's mostly rename/type-deletion ripple.
```

### C3 · r/cursor「How often do you restart your AI coding chat?」

```text
More than I'd like to admit. The restart cost isn't the chat — it's re-verifying that the previous run didn't quietly break the structure (hexagonal boundaries, DB-through-repository, that kind of thing). What cut it down for me: a local tool that diffs the dependency graph against git HEAD after each session and reports only this-round structural changes with evidence chains (Architecture Viewer, open source). Green light = commit; red = fix before moving on. Doesn't replace tests, just closes the "nobody can say what the architecture actually absorbed" gap.
```

---

## 发送后登记（发一条填一行）

| # | 渠道 | 对象 | 发出时间 | 状态 | 回复摘要 |
|---|---|---|---|---|---|
| A1 | 掘金私信 | #1 不破坏架构 | 2026-09-14 | 失败 | 两次「未知错误」，暂搁 |
| A2 | 掘金私信 | #2 SDD | 2026-09-14 | 已发 |  |
| A3 | 掘金私信 | #3 Prompt→Spec | 2026-09-14 | 已发 |  |
| A4 | 掘金私信 | #4 OpenSpec | 2026-09-14 | 已发 |  |
| A5 | 掘金私信 | #5 Cursor 四模式 | 2026-09-14 | 已发 |  |
| A6 | 掘金私信 | #6 质量保障体系 | 2026-09-14 | 已发 |  |
| B1 | GitHub | Graphenium | 2026-09-14 | 已发 | https://github.com/lambda-alpha-labs/Graphenium/issues/39 |
| B2 | GitHub | Yggdrasil | 2026-09-14 | 已发 | https://github.com/krzysztofdudek/Yggdrasil/discussions/95 |
| B3 | GitHub | archcodex | 2026-09-14 | 已发 | https://github.com/ArchCodexOrg/archcodex/discussions/32 |
| C1–C3 | Reddit | 三个 r/cursor 帖 | — | 跳过 | 用户此前明确跳过 |

**跟进规则**（outreach-kit §5）：已读未回 3 个工作日后最多跟一次；拒绝即止并记原话；感兴趣排期的约定具体日期。
