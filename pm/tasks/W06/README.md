# W06 任务卡 · 落地页 / npm 分发 / 冲榜（Marketplace 暂缓）

> 阶段：Phase 1 ｜ 周期：2026-10-05 ~ 2026-10-09 ｜ 周截止：2026-10-09
>
> 完成度：1/4 ███░░░░░░░ 25%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w06-01"></a>⬜ W06-01 · VS Marketplace + Open VSX 双上架 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 4h |
| 截止 | 2026-10-09 |
| 依赖 | [W03-02](../W03/README.md#w03-02)、[W04-02](../W04/README.md#w04-02) |
| 负责人 | heyangyan |
| 标签 | release / milestone / deferred |


**背景**：暂缓：VS Code 扩展方向推迟，Marketplace 上架一并暂缓。当前优先 CLI/MCP/网页三条路径。扩展重启时直接推进。

**目标**：（暂缓）扩展在两个市场可搜索、可安装；publisher 验证完成。

**涉及文件**：`package.json`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] VS Marketplace 页面可访问且可安装
- [ ] Open VSX 页面可访问（Cursor 可装）
- [ ] 安装后五条命令可用

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  echo '人工验收：两个市场页面 URL 记录到 pm/checklists/release-smoke.md'
  ```

**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w06-02"></a>✅ W06-02 · 落地页发布（定价 + demo + 安装） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | 2026-10-09 |
| 依赖 | [W01-05](../W01/README.md#w01-05)、[W05-03](../W05/README.md#w05-03)、[W05-02](../W05/README.md#w05-02) |
| 负责人 | heyangyan |
| 标签 | web / growth |


**背景**：落地页是广告投放、博主转发、PH 的承接页。

**目标**：公网可访问的落地页：价值主张、demo 视频、定价三档、安装按钮、GitHub 链接。

**涉及文件**：`web/public/index.html` `web/server.js` `docs/landing-deploy.md` `.github/workflows/landing-pages.yml`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 落地页公网 URL 可访问（部署方式记录）
- [ ] 含定价表（Free/Pro ¥29/Team ¥999/仓/年）
- [ ] 含安装命令与 demo 视频

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "29" web/public/index.html && grep -qi "install" web/public/index.html && echo LANDING_OK
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-05 状态变更 todo→doing：落地页嵌入 demo 视频、VTT、部署 SOP、Pages 工作流
  - 2026-09-05 状态变更 doing→done：落地页嵌入 60s demo+中英字幕，定价/安装已有；docs/landing-deploy.md 记录本机/Docker/Pages；Actions 发 gh-pages

---

### <a id="w06-03"></a>⬜ W06-03 · 新品榜冲榜 + Product Hunt 提交 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 4h |
| 截止 | 2026-10-09 |
| 依赖 | [W06-01](../W06/README.md#w06-01)、[W06-02](../W06/README.md#w06-02) |
| 负责人 | heyangyan |
| 标签 | growth / launch |


**背景**：上架首周自然流量窗口最宝贵；PH 徽章有长期社会证明价值（流量 72h 后衰减 80%）。

**目标**：上架首周安装 ≥100；PH 提交页就绪并选好发布日；社群发布节奏表执行。

**涉及文件**：`pm/growth/launch-checklist.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] launch-checklist 含发布日、渠道清单、话术
- [ ] 首周安装量记录 ≥100
- [ ] PH 页面 URL 记录

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/growth/launch-checklist.md && echo LAUNCH_OK
  ```

**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w06-04"></a>⬜ W06-04 · 安装与激活指标看板 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 2h |
| 截止 | 2026-10-09 |
| 依赖 | [W04-04](../W04/README.md#w04-04) |
| 负责人 | heyangyan |
| 标签 | metrics |


**背景**：周报需要安装/激活数据支撑转化率判断。数据源改为 npm 下载 + CLI/网页遥测；Marketplace 后台待扩展重启后再加。

**目标**：pm/metrics.md 模板：周安装、周活跃、Generate 触发数、Pro 登录数，每周五随周报更新。

**涉及文件**：`pm/metrics.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] metrics.md 含数据口径与首周数据
- [ ] 周报脚本引用或人工同步

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/metrics.md && echo METRICS_OK
  ```

**参考文档**：—

**活动记录**：
  - （暂无）
