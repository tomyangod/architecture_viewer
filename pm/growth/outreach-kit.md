# 触达模板包（首批试点招募）

> **附录：触达模板。** 主说明与口径终审见 [seed-users.md](seed-users.md)。所有模板为手动发送，逐条核实后再发，禁止群发套话。
> 关联：[红→绿样例](red-green-sample.md) · [验证计划](../plans/pilot-validation-6w.md)

## 0. 口径基准（发任何消息前对齐）

**一句话定位：**
> AI 改码后，对照 git HEAD 检查新增跨层依赖和结构变化；本地运行，不替代测试和业务逻辑审查。

**CTA 阶梯纪律（2026-09-15 起执行）：**
> 首次触达**仅要一句话回复**（如确认痛点的轻问）或给零承诺礼物（npx 一行命令/样例），**禁止直接要 15 分钟会议**。访谈与试点仅在对方回复后、第二或第三轮再提。允许每级明确退出（「暂不需要」）。

| 项 | 准确说法 | 不能说 |
|---|---|---|
| 版本 | 试点钉 `arch-viewer@0.12.2-rc.6`（npm `next`） | "装 latest 就行"（latest 是 0.12.1，缺本轮修复） |
| 价格 | Pro ¥29/月（验证期定价）；Team ¥99/人/月且仅人工申请 | 承诺折扣、半年赠送换"付费意向"、旧 ¥999/年/仓库 |
| 付款 | 爱发电可付（页面已在线）；微信/对公转账后人工开通；卡支付待配置 | "支持信用卡自助开通" |
| 许可 | Community 本地能力 Apache-2.0 | "整仓随便再分发"（托管/账号为商业许可路线） |
| 卸载 | `arch-viewer uninstall .`；默认保留规则与证据 | "删整个 `.av/` 即可" |
| 托管 | 核心链路已验证；**公网 webhook 自动投递尚未上线（NOT RUN）** | "现在就能托管 PR 评论" |
| 本地版 | 免费、离线、不要代码、不要 token | 暗示要把私有代码传上来；宣传未发布实验规则 |
| 证据 | 演示样例是**人为构造**；图上「Human review required / static draft」表示协议通过≠运行时正确 | 把演示说成客户案例；把绿灯或图协议 PASS 说成架构已验证 |

## 1. 首次触达（三个渠道变体）

**重要：** 首次触达**不要 15 分钟会议**，仅：① 引子（精准引用对方痛点）+ ② 工具 2–3 句话 + ③ **一个轻问**（可一句话回复）或零承诺礼物（npx 命令/样例）。访谈移至 §2,仅在对方回复后使用。

**GitHub 特别规则（2026-09-15 起）：** 禁止在第三方仓库新开招募 issue;优先回复现有 discussion/issue,或引导到 tomyangod/architecture_viewer 自有仓库讨论区报名。

**CTA 终点优先级：** 回复本消息（最低摩擦）> GitHub discussion（tomyangod/architecture_viewer）> Gitee IKF74T（仅作国内用户备选）。

### A. GitHub / Gitee 公开项目（现有讨论回复或轻问）

**场景 1：回复现有 issue/discussion（优先）**

```text
Hi [Name], I saw your point about [specific pain: e.g. "AI changes broke layering and no one noticed until production"]. 

I'm testing Architecture Viewer (open source, Apache-2.0): after AI edits, it diffs the dependency graph vs git HEAD and reports only this-round structural changes (new cross-layer edges, deleted types, blast radius) with file-path evidence. Fully local/offline, pinned to arch-viewer@0.12.2-rc.6.

Quick question: how do you currently catch cross-layer violations before merging? (Manual review? Static tool? Post-merge?)

If useful, I can share a one-liner npx command (no install) or run a demo on one of your recent PRs.
```

（中文版）

```text
你好 [名字]，看到你提到 [具体痛点：如「AI 改动后没人说得清架构变了什么」/ 「跨层依赖人工 review 漏了」]。

我在测试开源工具 Architecture Viewer（Apache-2.0）：AI 改完后对照 git HEAD 检查本轮新增的跨层依赖、删除类型和影响面，带文件路径和依赖链可复核。本地离线，钉 arch-viewer@0.12.2-rc.6。

想问一句：你们现在合入前靠什么确认没跨层？（人工？工具？合入后再说？）

如果有用，我可以发一行 npx 命令（无需安装）或拿你们最近一个 PR 跑一次演示。
```

**场景 2：无现有讨论，引导到自有仓库（次选）**

```text
（在对方仓库 README/文档相关位置礼貌留言）

Hi, noticed [your project] deals with [architecture constraint / module boundaries]. Built Architecture Viewer to solve a related problem: checking what structurally changed after AI edits (cross-layer deps, impact radius) vs git HEAD.

If this resonates, feel free to join the discussion at https://github.com/tomyangod/architecture_viewer/discussions — happy to share npx one-liner or sample there.
```

（中文版，引导到 GitHub 或 Gitee）

```text
你好，看到 [你们项目] 有 [架构分层 / 模块边界] 相关的实践。我做了个工具 Architecture Viewer 解决类似问题：AI 改完后检查本轮结构变化（跨层依赖、影响面）对照 git HEAD。

如果有共鸣，欢迎到 https://github.com/tomyangod/architecture_viewer/discussions （或 Gitee https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T ）讨论，可以发 npx 一行命令或样例。
```

### B. 掘金 / 知乎等技术文章作者（轻问 + 可选礼物）

```text
你好 [名字]，看了《[文章名]》，其中 [具体痛点引用：1 句话] 特别有共鸣。

我在测试开源工具 Architecture Viewer：AI 改完后对照 git HEAD 检查本轮新增跨层依赖和影响面，本地离线，钉 arch-viewer@0.12.2-rc.6。

想问一句：你们现在合入前靠什么确认没跨层？（人工过 diff？dependency-cruiser？合入后再说？）

如果感兴趣，我可以：
- 发一行 npx 命令，3 秒跑完看红绿灯（无需安装）
- 或发脱敏样例图，看报告长什么样

回复「要」或「暂不需要」都可以，不打扰。
```

### C. 社区招募区（公开发帖，给 npx 命令 + 讨论区链接）

```text
【开源工具】AI 改码后的架构验收：本轮新增了哪些跨层依赖？

Architecture Viewer（Apache-2.0）：对照 git HEAD 检查本轮新增跨层依赖、删除类型、影响面，带文件路径可复核。本地离线，代码不出本机。

**试一下（无需安装）：**
```bash
npx --yes arch-viewer@0.12.2-rc.6 session report <your-repo-path>
```

脱敏样例见 [链接] 或贴图。

讨论 / 反馈 / 报名试点：https://github.com/tomyangod/architecture_viewer/discussions （国内用户可到 Gitee https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T ）

适合：有 PR 流程、常用 AI 跨文件改码、有模块边界的团队。
```

## 2. 访谈提纲（15 分钟，**仅在对方回复 §1 轻问后使用**）

**前置条件：** 对方已回复 §1 的轻问（如"我们靠人工 review"/"dependency-cruiser 但噪音多"），确认痛点真实且有意愿进一步交流。此时可提议"方便的话约 15 分钟详细聊聊"。

按顺序问，回答前不演示产品：

1. 最近一次 AI（或人）跨文件改动后，出现结构问题/依赖串层是什么时候？讲一下经过。
2. 谁发现的？合并前还是合并后？花了多久？
3. 当时 CI / CodeRabbit / dependency-cruiser / Import Linter / 人工评审为什么没拦住（或拦住了）？
4. 这类问题多久出现一次？每次评审额外花多少时间？
5. 如果有个工具只报本轮相关的结构变化，你们会放在哪个环节用？谁会看？
6. （最后）愿不愿意用一个真实变更试一次？

**筛选判断：**
- 说得出具体事件、时间、发现者 → 合格样本。
- 只有"图挺好看""可以试试" → 保持联系，不作首批主样本。
- 已有工具完全覆盖且无额外负担 → 记入对照 A 组，不硬推。

## 3. 接入邀请（访谈合格后发）

```text
谢谢今天的交流。按你说的情况，建议这样开始：

1. 本周内选一个正在开发的仓库和一个真实 PR，我陪你跑第一次（约 30 分钟）。
2. 版本统一用 0.12.2-rc.6：npx --yes --package arch-viewer@0.12.2-rc.6 arch-viewer session report <仓库路径>
3. 第一周只作旁路参考，不设阻断；你们判断哪些发现有价值。
4. 每周用我发的表格反馈一次，约 15 分钟。
5. 本地分析永久免费；托管 PR 评论的公网自动投递还没上线，需要的话先记下来，上线后单独验证。

确认的话我把两周试点说明和脱敏样例发你。
```

## 4. 两周试点说明（可直接转发）

```text
Architecture Viewer 两周本地试点说明

· 做什么：在你们一个真实仓库上，用固定版本 0.12.2-rc.6 对照 git HEAD
  检查每轮改动的结构变化（跨层依赖、删除类型、影响面），与现有 review 并行。
· 成本：本地 CLI 免费；不要求提供私有代码、仓库地址或任何 token；分析全程离线。
· 你们的投入：首次接入约 30 分钟（可协助）；之后每周约 15 分钟反馈。
· 反馈内容：哪条发现有用/没用/重复、现有工具是否已报、有没有改变评审决定。
· 数据：只记录脱敏后的发现与耗时，不记录代码内容；发布任何材料前先经你们确认。
· 退出：随时停止试用即可。卸载用 `arch-viewer uninstall .`（可加 `--npm`）；默认保留分层规则与证据，勿整目录删除 `.av/`。
· 付费：试点期不收费。Pro（¥29/月，托管评论等）和 Team（人工申请）是后续单独选择，
  与本次试点无关，不会因为试用被推销或扣款。
```

## 5. 跟进模板

**Day-3 跟进（3 个工作日后，最多跟一次，给价值不要日历）：**

**版本 A：礼物型（优先）**

```text
[名字] 你好，理解可能在忙优先级更高的事。

如果你们最近合入过 AI 大改的 PR（或正在 review 的），我可以拿 diff 跑一次 Architecture Viewer 演示（公开仓库直接跑 / 私有仓库你发我 git diff 输出），看红绿灯和跨层依赖报告准不准，**你不用装任何东西**。

或者我发一行 npx 命令 + 脱敏样例图，回头有空可以自己试。

如果最近没这类需求也完全 OK，回复「暂不需要」即可，我不再打扰。
```

（英文版）

```text
Hi [Name], totally understand if this isn't a current priority.

If you have a recent AI-heavy PR (merged or under review), I can run Architecture Viewer on the diff as a demo (public repo: I'll run it; private: send me `git diff` output) — shows cross-layer findings with zero setup on your end.

Or I can share the npx one-liner + sample screenshots for later.

If it's not relevant right now, just reply "not needed" and I won't follow up again.
```

**版本 B：对比文章/样例（次选）**

```text
[名字] 你好，不知道上次提到的架构检查工具是否有机会看。

我整理了一份 dependency-cruiser vs Import Linter vs Architecture Viewer 的定位对比（各自适合什么场景、覆盖什么检查），如果感兴趣回复「要」我发你。

或者回复「暂不需要」也完全 OK，我不再打扰。
```

**版本 C：最小负担确认（保底）**

```text
[名字] 你好，理解可能忙。如果最近没有这类痛点也完全没问题，回复一个"暂不需要"即可，我不再打扰。
```

**拒绝后：** 停止跟进，在触达记录表记原因原话，不辩解、不二次推销。

**感兴趣但要排期：** 约定不超过 2 周的具体日期；到期前 2 天提醒一次；失约两次关闭线索。

**接入后第一周（主动但不催促）：**

```text
本周不催使用。只想确认一件事：报告你们实际打开看了吗？
如果看了：哪条最接近有用/最像噪音？如果没看：是什么环节没接上？
```

## 6. 触达记录（每条消息必填，登记到 [seed-users.md](seed-users.md) 漏斗）

| 日期 | 渠道 | 对象/链接 | 团队画像（语言/规模/现有工具） | 具体痛点引子 | 状态（已触达/已访谈/已接入/拒绝） | 拒绝原因原话 |
|---|---|---|---|---|---|---|

纪律：只对有具体公开讨论可引用的对象发个性化消息；拒绝即止；访谈、免费开通、朋友支持款都不计入获客成功；**外部团队自己完成接入、报告改变一次真实评审决定、无催促下继续使用**——三条证据凑齐才算验证有进展。
