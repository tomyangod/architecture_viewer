# W05 任务卡 · 付费门禁 / 支付通道（国庆假期，轻量）

> 阶段：Phase 1 ｜ 周期：2026-09-28 ~ 2026-10-02 ｜ 周截止：2026-10-02
>
> 完成度：1/3 ███░░░░░░░ 33%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w05-01"></a>✅ W05-01 · Free/Pro 门禁可演示 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 5h |
| 截止 | 2026-10-02 |
| 依赖 | [W02-06](../W02/README.md#w02-06)、[W03-01](../W03/README.md#w03-01) |
| 负责人 | heyangyan |
| 标签 | pro / account |


**背景**：国庆周轻量任务；门禁是支付的前置，必须先能演示「免费能用、Pro 要登录」。

**目标**：Pro 特性（云端精修入口、增量同步占位）未登录时 CLI/网页提示升级；Pro 账号登录后放行；特性开关服务端可配。扩展端门禁暂缓。

**涉及文件**：`lib/pro/auth-client.js` `lib/pro/entitlement.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 未登录调用 Pro CLI 命令时提示升级（含定价页链接）
- [ ] Pro 账号登录后命令可执行
- [ ] Community 能力永不禁用（COMMERCIAL.md 承诺）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "requireUser\|entitlement" lib/pro/auth-client.js && echo GATE_OK
  ```

**参考文档**：`COMMERCIAL.md`

**活动记录**：
  - 2026-09-04 状态变更 todo→doing：开工：Free/Pro 门禁（云端精修 + 增量同步占位）
  - 2026-09-04 状态变更 doing→done：Free/Pro 门禁可演示：requirePro/requireProFeature，未登录 CLI pro refine|sync 提示升级+定价页；试用/Pro 放行；ARCH_PRO_FEATURES 可关特性；Community generate/check/session/--refine 永不登录墙。GATE_OK + test/pro-gate.test.js。

---

### <a id="w05-02"></a>⬜ W05-02 · 支付通道接入（爱发电/微信 + Lemon Squeezy 占位） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 5h |
| 截止 | 2026-10-02 |
| 依赖 | [W05-01](../W05/README.md#w05-01) |
| 负责人 | heyangyan |
| 标签 | pro / billing |


**背景**：国内爱发电/微信支付路径最短，海外 Lemon Squeezy 处理税务合规；先收款再自动化。

**目标**：国内收款链接可用 + 支付后手动/半自动开通 Pro 的 SOP；Lemon Squeezy 商品页创建（可沙箱）。

**涉及文件**：`web/lib/billing.js` `docs/billing.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 爱发电/微信收款链接在定价页可点
- [ ] billing.md 记录「付款 → 核验 → 开通 Pro」操作步骤
- [ ] Lemon Squeezy 商品页（或沙箱）链接记录在案

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f docs/billing.md && grep -q "Pro" docs/billing.md && echo BILLING_OK
  ```

**参考文档**：`COMMERCIAL.md`

**活动记录**：
  - （暂无）

---

### <a id="w05-03"></a>⬜ W05-03 · 60 秒 demo 视频成片（双语字幕） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 3h |
| 截止 | 2026-10-02 |
| 依赖 | [W04-01](../W04/README.md#w04-01) |
| 负责人 | heyangyan |
| 标签 | growth / content |


**背景**：假期缓冲项；视频用于落地页、README、PH 发布。Marketplace 介绍暂缓。

**目标**：60 秒演示：session start → 改代码 → session report 红灯 / Before-Delta-After，中英字幕。

**涉及文件**：`docs/demo.mp4`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 视频时长 45–90 秒
- [ ] 含中英字幕或字幕文件
- [ ] 落地页与 README 可嵌入

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f docs/demo.mp4 && echo VIDEO_OK
  ```

**参考文档**：—

**活动记录**：
  - （暂无）
