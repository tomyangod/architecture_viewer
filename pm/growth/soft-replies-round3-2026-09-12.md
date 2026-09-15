# 第三轮软触达（2026-09-12）

> 以下为当日发出原文。**新消息改钉 `0.12.2-rc.6`**，见 [outreach-kit.md](outreach-kit.md)。

招募：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T  
掘金长文：https://juejin.cn/post/7684463933702029322  
当时钉版本：`arch-viewer@0.12.2-rc.2`（历史记录；现钉 rc.3）

> 手动发；拒绝后停。已发过的帖勿重复刷。

## A. 掘金（第 3 轮，待发）

### A1｜Cursor 四模式：Ask → Plan → Agent
https://juejin.cn/post/7658998681744605219

Ask/Plan 再 Agent 很对。停手后还缺一刀结构验收：对照 git HEAD 看有没有新增跨层依赖（Controller→DB 这类）。开源本地 CLI，钉 `arch-viewer@0.12.2-rc.2`。招 2 个非关联 Python/TS 队试用：Issue IKF74T  
https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T

### A2｜AI 辅助交付的质量保障体系（checklist + 自动化）
https://juejin.cn/post/7623711769807634483

你们把「AI 生成 + 人审 + 自动化」分层做得很清楚。我们在补自动化里常漏的一块：增量架构门（layer-skip / 结构漂移），纯本地、不上传代码。试点：IKF74T（Gitee）。

### A3｜（备用）若评论区已关或重复感强，改回自己沸点再贴一轮短链
文案可复用 round2 沸点；或只贴长文 + Issue，少提工具名堆砌。

## B. Reddit（recruit-kit §5，待账号发出）

统一入口 **Gitee Issue IKF74T**，版本钉 **0.12.2-rc.2**。

| # | 线索 | 渠道 | 状态 |
|---|---|---|---|
| 1 | Architectural drift + CI gates | r/cursor | 待账号发 |
| 2 | Agentic coding → review 瓶颈 | r/cursor | 待账号发 |
| 3 | Stop Cursor designing DB | r/CursorAI | 待账号发 |
| 4 | Architecture-first vs code-first | Reddit | 待账号发 |

英文软评骨架（每帖改「具体共鸣点」一句）：

```text
Agree — unit tests stay green while layering quietly drifts.
We've been dogfooding a local OSS gate that diffs against git HEAD for new cross-layer edges (not a substitute for review). Pin arch-viewer@0.12.2-rc.2.
Recruiting 2 unrelated Python/JS/TS teams for a free local pilot: https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
```

## C. 本轮不做
- V2EX（无号 / 无 Google·GitHub 登录）
- 无关帖群发、重复评论已触达 URL

## D. 发送记录（填）
| 日期 | 渠道 | URL | 结果 |
|---|---|---|---|
|  |  |  |  |
