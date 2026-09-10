# W15 任务卡 · backlog

> 阶段：Phase 3 ｜ 周期：— ~ 持续 ｜ 周截止：—
>
> 完成度：8/8 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w15-01"></a>✅ W15-01 · B+ 验收 1/8：worktree/子目录场景不检查错目录 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 2h |
| 截止 | — |
| 依赖 | [W14-01](../W14/README.md#w14-01) |
| 负责人 | heyangyan |
| 标签 | qa / b-plus-gate |


**背景**：AI 常把主仓绝对路径复制进 worktree / 子目录，session start 会拍错照片、报告假绿。macOS /var 与 /private/var 也曾被误判成两个 Git 根。

**目标**：主仓、worktree、子目录三种场景 session start 回显检查目录正确；worktree 明确警告；路径不一致 fail-closed，不静默用错。

**涉及文件**：`lib/session-paths.js` `lib/cli.js` `mcp/server.js` `test/session-paths.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 在主仓、worktree、子目录三种场景各跑一次 session start，回显路径正确；worktree 场景明确警告；路径不一致时 AI 不会静默用错

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/session-paths.test.js
  ```

**参考文档**：`pm/reports/W15-B-plus-gate.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：主仓/worktree/子目录 session start 回显正确；/var vs /private/var 不再误杀；路径不一致 fail-closed

---

### <a id="w15-02"></a>✅ W15-02 · B+ 验收 2/8：Python + JS 各两个真实结构改动视觉验收 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 6h |
| 截止 | — |
| 依赖 | [W14-04](../W14/README.md#w14-04) |
| 负责人 | heyangyan |
| 标签 | qa / b-plus-gate / visual |


**背景**：合成图对了但真实提取后 Delta 图与 findings 可能对不齐，视觉验收才能挡住「红灯对了、图画错了」。

**目标**：Python 跨层 / 删边 / 神文件 + JS 跨层 / 删边：CLI 报告图边与 findings 端点一致，顶栏数量等于图上边数。

**涉及文件**：`test/visual-acceptance.test.js` `lib/session-report.js` `lib/risk-rules.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] Python 仓：新增跨层 import、删除依赖、新增神文件；JS 仓：同结构改动 2 种。Delta 图与 findings 一致，边/节点数量正确

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/visual-acceptance.test.js
  ```

**参考文档**：`pm/reports/W15-B-plus-gate.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：Python 跨层/删边/神文件 + JS 跨层/删边，Delta 图与 findings 对齐

---

### <a id="w15-03"></a>✅ W15-03 · B+ 验收 3/8：顶部统计/Delta 图/findings/JSON 四口径一致 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | — |
| 依赖 | [W14-02](../W14/README.md#w14-02) |
| 负责人 | heyangyan |
| 标签 | qa / b-plus-gate / consistency |


**背景**：顶栏、Delta 图、findings、JSON 曾各算各的（归属边进顶栏、违规只写 findings 不写 diff.violations）。

**目标**：5 个合成场景 + beginner-demo / tutorial-demo 两真实仓：顶栏架构边 = 图边 = JSON 高信号边；图 violation = findings ∪ diff.violations。

**涉及文件**：`test/four-way-consistency.test.js` `lib/session-report.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 对 5 个合成场景 + 2 个真实仓改动，断言顶部新增关系数 = Delta 图边数 = findings 涉及边数 = JSON addedEdges 数（按类型过滤后）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/four-way-consistency.test.js
  ```

**参考文档**：`pm/reports/W15-B-plus-gate.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：5 合成 + beginner-demo/tutorial-demo 四口径；顶栏违规=图 violation

---

### <a id="w15-04"></a>✅ W15-04 · B+ 验收 4/8：刷新基线后旧报告不误读 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 2h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | qa / b-plus-gate |


**背景**：刷新基线后若旧 HTML/JSON 还在，用户会把上一轮红灯当成当前结果。

**目标**：session start 删除 session-report* / archify-*；删不掉则覆写过期存根；HTML 顶部恒有点时快照横幅。

**涉及文件**：`lib/session-report.js` `test/stale-report.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] session start 后旧 HTML/JSON 被清除；残留文件顶部有过期标记；用户不会把旧红灯当成当前结果

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/stale-report.test.js
  ```

**参考文档**：`pm/reports/W15-B-plus-gate.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：session start 清旧报告；删失败覆写过期存根

---

### <a id="w15-05"></a>✅ W15-05 · B+ 验收 5/8：绿灯明确说「无架构变化」而非「代码没变化」 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 1h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | qa / b-plus-gate / copy |


**背景**：函数体/注释改了但结构指纹不变时，旧文案「无变化」会被理解成代码完全没动。

**目标**：零结构变化时 CLI/MCP/HTML/PR 都写「未检测到架构结构变化」，有 contentFingerprint 时明确说源码内容变了；禁止裸「无变化」。

**涉及文件**：`lib/green-light.js` `test/green-light-copy.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 函数体内改动、注释改动等非架构变化时，报告明确写「未检测到架构结构变化（源代码内容可能已修改）」，不说「无变化」

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/green-light-copy.test.js
  ```

**参考文档**：`pm/reports/W15-B-plus-gate.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：绿灯写未检测到架构结构变化，不说无变化

---

### <a id="w15-06"></a>✅ W15-06 · B+ 验收 6/8：HIGH finding 三端一致（CLI/MCP/HTML） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 3h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | qa / b-plus-gate / consistency |


**背景**：CLI / MCP / HTML 若各自格式化 findings，会出现「命令行 HIGH、网页绿灯」的安全感错觉。

**目标**：同一跨层改动：CLI exit 1、MCP riskLevel=high、HTML 红灯，三端 finding 数量/标题/rule 一致。

**涉及文件**：`test/high-finding-three-way.test.js` `lib/cli.js` `mcp/server.js` `lib/session-report.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 同一仓库同一改动，CLI 退出码 1、MCP 返回 riskLevel=high、HTML 显示红灯，三者 finding 数量和标题一致

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/high-finding-three-way.test.js
  ```

**参考文档**：`pm/reports/W15-B-plus-gate.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：同一跨层改动 CLI exit1 / MCP high / HTML 红灯，标题一致

---

### <a id="w15-07"></a>✅ W15-07 · B+ 验收 7/8：零文档新手完成拍照-改码-验收全流程 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 3h |
| 截止 | — |
| 依赖 | [W15-01](../W15/README.md#w15-01)、[W15-02](../W15/README.md#w15-02) |
| 负责人 | external |
| 标签 | qa / b-plus-gate / user-test |


**背景**：新手不看文档时，若工具返回没有 nextStep / 工具名，会在误调 report、改完不知复查、绿灯后不刷新基线上迷路。

**目标**：只靠 MCP 返回的 message/error/nextStep 走完：误调→拍照→改码红灯→检查→报告→修复→复查→刷新基线，关键路径不迷路。

**涉及文件**：`test/beginner-flow.test.js` `mcp/server.js` `pm/reports/W15-07-beginner-flow.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 邀请 1 名不看文档的真实开发者，用 MCP 完成一次完整 session 循环，成功率 ≥ 80%，关键路径不迷路

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test --test-timeout 120000 test/beginner-flow.test.js
  ```

**参考文档**：`pm/reports/W15-07-beginner-flow.md` `pm/reports/W15-08-blind-test.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：零文档 MCP 循环 8/8；见 W15-07-beginner-flow.md

---

### <a id="w15-08"></a>✅ W15-08 · B+ 验收 8/8：至少 1 名非本人用户盲测 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | — |
| 依赖 | [W15-07](../W15/README.md#w15-07) |
| 负责人 | external |
| 标签 | qa / b-plus-gate / user-test |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 1 名外部开发者在不知道项目背景的情况下，用 30 分钟完成安装 + 一次 session 验收，给出净推荐值和真实痛点记录

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）
