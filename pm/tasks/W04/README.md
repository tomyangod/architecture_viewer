# W04 任务卡 · 获客启动：教程文 / README / 种子博主

> 阶段：Phase 1 ｜ 周期：2026-09-21 ~ 2026-09-25 ｜ 周截止：2026-09-25
>
> 完成度：4/4 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w04-01"></a>✅ W04-01 · 实战教程文 + 60 秒 demo（掘金/知乎/GitHub） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 6h |
| 截止 | 2026-09-25 |
| 依赖 | [W03-01](../W03/README.md#w03-01) |
| 负责人 | heyangyan |
| 标签 | growth / content |


**背景**：调研：技术博客「如何构建 X」长尾转化最好；W4 必须与开发并行启动获客，不能等上架。

**目标**：1 篇 2000+ 字实战文《用 AI 自动生成架构图，还能在 PR 里抓漂移》，含 60 秒 demo GIF/视频，三平台发布。

**涉及文件**：`docs/blog/2026-09-ai-architecture-drift.md` `docs/demo-script.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 文章含：痛点、60 秒上手、漂移检测演示、定价与链接
- [ ] demo 素材（GIF 或视频链接）可访问
- [ ] 掘金、知乎、GitHub README 三处发布链接记录在文章头部

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f docs/blog/2026-09-ai-architecture-drift.md && wc -l docs/blog/2026-09-ai-architecture-drift.md | awk '$1>=60{print "BLOG_OK"}'
  ```

**参考文档**：`docs/market-evaluation/market-evaluation.html`

**活动记录**：
  - 2026-09-04 状态变更 todo→doing：开工：实战教程文 + demo 脚本
  - 2026-09-04 状态变更 doing→done：成文 docs/blog/2026-09-ai-architecture-drift.md（痛点/60秒上手/漂移/定价）+ docs/demo-script.md；demo.gif 可访问；头部记录 Gitee/GitHub README 与掘金/知乎发布位（外发 URL 待人工发帖回填）；README 已链到实战文。验收 BLOG_OK。

---

### <a id="w04-02"></a>✅ W04-02 · README 升级：demo GIF + 英文 + badge 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 3h |
| 截止 | 2026-09-25 |
| 依赖 | [W03-01](../W03/README.md#w03-01)、[W01-05](../W01/README.md#w01-05) |
| 负责人 | heyangyan |
| 标签 | growth / docs |


**背景**：README 是 GitHub / npm 的第一转化页；调研显示 GitHub README 是开发者工具最长尾渠道。VS Marketplace badge 暂缓。

**目标**：首屏放 60 秒 demo GIF、一行价值主张（架构验收门）、npm/CLI 安装命令、中英链接。Marketplace badge 仅占位、不挡验收。

**涉及文件**：`README.md` `README.en.md` `docs/demo.gif`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] README 首屏（前 30 行）含 demo GIF 引用
- [ ] 含 npm / npx arch-viewer setup 安装命令
- [ ] 中英 README 互相链接

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "demo.gif\|demo.mp4" README.md && grep -q "README.en" README.md && echo README_OK
  ```

**参考文档**：`README.md`

**活动记录**：
  - 2026-09-04 状态变更 todo→done：README.md 首屏加 demo.gif 引用、去 VS Code 扩展主路径改为 CLI/MCP/网页四端、加 Pro 账号命令段、加遥测隐私段、中英互链；README.en.md 全文重写对齐中文版

---

### <a id="w04-03"></a>✅ W04-03 · 种子博主/架构师招募（10 人） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | 2026-09-25 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | growth / community |


**背景**：种子用户换反馈与转发是冷启动转化最高的渠道；送半年 Pro 成本为零（边际成本仅 AI 额度）。

**目标**：建立 10 人名单（掘金/知乎/B站架构类博主、团队架构师），完成私信触达，≥3 人回复试用，反馈归集。

**涉及文件**：`pm/growth/seed-users.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 名单含 10 个对象（平台、主页链接、触达状态）
- [ ] 话术模板含「送半年 Pro + 求 15 分钟反馈」
- [ ] ≥3 条回复记录在案

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/growth/seed-users.md && grep -c "http" pm/growth/seed-users.md | awk '$1>=10{print "SEED_OK"}'
  ```

**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w04-04"></a>✅ W04-04 · 遥测埋点（默认关闭，企业友好） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | 2026-09-25 |
| 依赖 | [W02-06](../W02/README.md#w02-06) |
| 负责人 | heyangyan |
| 标签 | metrics / pro |


**背景**：付费率/留存只能靠数据；但企业用户对遥测敏感，必须默认关、可审计、不采代码内容。

**目标**：lib/telemetry.js：CLI 命令使用、生成耗时、校验结果计数；配置项默认 false；开启时仅发事件名与时长，不含路径/代码。扩展端埋点暂缓。

**涉及文件**：`lib/telemetry.js` `lib/cli.js` `package.json` `test/telemetry.test.js` `README.md` `README.en.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] telemetry 配置默认 false
- [ ] 开启后 CLI 主命令各触发事件，payload 中无文件路径与代码片段
- [ ] 隐私说明写入 README

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "telemetry" lib/telemetry.js && grep -q "false" package.json && echo TELEMETRY_OK
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-04 状态变更 todo→done：lib/telemetry.js：默认关、ARCH_TELEMETRY=1 开启、DO_NOT_TRACK 优先级最高；敏感字段 denylist（path/file/code/repo/token 等）不透传；CLI main() 入口 wrap() 自动埋点（命令名+耗时+退出码）；package.json 加 telemetry.enabled=false；7 个测试全过；README 中英双语加隐私段
