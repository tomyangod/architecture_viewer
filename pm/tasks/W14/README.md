# W14 任务卡 · 门禁硬化：pre-commit + session 代码图层规则

> 阶段：Phase 2.5 ｜ 周期：2026-09-06 ~ 2026-09-12 ｜ 周截止：2026-09-12
>
> 完成度：7/7 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w14-01"></a>✅ W14-01 · pre-commit 钩子模板：session HIGH 挡提交 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 3h |
| 截止 | 2026-09-12 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | core / gate / moat |


**背景**：session report HIGH 时退出码已是 1，但无现成 git 钩子；门禁靠 AI/人自觉，有安全感错觉。

**目标**：提供可复制的 pre-commit 模板：有基线则跑 session report，HIGH 拒绝提交；无基线跳过。文档写清安装与 --no-verify。

**涉及文件**：`templates/pre-commit` `docs/guides/quickstart.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] templates/pre-commit 存在且含 session report / graph-baseline 逻辑
- [ ] quickstart 有 §6.3 安装说明
- [ ] 无基线时钩子 exit 0；有 HIGH 时 exit 1（人工或测试验证）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f templates/pre-commit && grep -q 'session report' templates/pre-commit && grep -q 'graph-baseline' templates/pre-commit && echo HOOK_OK
  ```
  ```bash
  grep -q '6.3' docs/guides/quickstart.md && grep -q 'pre-commit' docs/guides/quickstart.md && echo DOCS_OK
  ```

**参考文档**：`docs/guides/quickstart.md` `templates/architecture-check.yml`

**活动记录**：
  - 2026-09-06 状态变更 todo→doing：落地 templates/pre-commit + quickstart §6.3
  - 2026-09-06 状态变更 doing→done：验收命令通过；E2E session 同时亮 layer-skip + no-controller-to-storage

---

### <a id="w14-02"></a>✅ W14-02 · session report 吃代码图层自定义规则（forbid_cross_layer） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 8h |
| 截止 | 2026-09-12 |
| 依赖 | [W07-02](../W07/README.md#w07-02) |
| 负责人 | heyangyan |
| 标签 | core / moat / team |


**背景**：architecture-rules.yaml 的 check --rules 只审 C4 文档 Rel；session 验收门只有硬编码 risk-rules。团队『domain 不许 import infra』进不了日常验收。

**目标**：session report / MCP 自动加载 architecture-rules.yaml；forbid_cross_layer 对照本轮新增代码边（节点已有 layer）产出 HIGH finding；CLI 支持 --rules；naming/rel_whitelist 仍仅 check。

**涉及文件**：`lib/risk-rules.js` `lib/cli.js` `mcp/server.js` `architecture-rules.example.yaml` `test/session-code-rules.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] evaluateRisk 可选 rules：forbid 命中 controller→storage 产生 rule id finding
- [ ] session report --rules <file> 可加载；未传则自动发现仓库根/套件目录
- [ ] example yaml 文案写清 check vs session 两套消费面
- [ ] npm test 含 session-code-rules 用例且全绿

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/session-code-rules.test.js
  ```
  ```bash
  npm test
  ```

**参考文档**：`lib/rules.js` `architecture-rules.example.yaml`

**活动记录**：
  - 2026-09-06 状态变更 todo→doing：applyTeamForbidCrossLayer + CLI/MCP 接线
  - 2026-09-06 状态变更 doing→done：验收命令通过；E2E session 同时亮 layer-skip + no-controller-to-storage

---

### <a id="w14-03"></a>✅ W14-03 · 修正文档过度承诺：循环依赖非现成能力 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 1h |
| 截止 | 2026-09-12 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | docs / honesty |


**背景**：ARCHIFY-COMPARISON 把『循环依赖』写成风险规则引擎已有能力，但 risk-rules.js 无环检测；会误导路线与竞品对比。

**目标**：改对比报告表述：列出真实已有规则，并标明循环依赖未实现、yaml 规则只管 C4。

**涉及文件**：`pm/reports/ARCHIFY-COMPARISON-2026-09-04.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 对比报告不再把循环依赖列为现成风险规则
- [ ] 注明 C4 yaml 与代码图规则分面

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -E '不是.*现成能力|循环依赖.*尚未实现' pm/reports/ARCHIFY-COMPARISON-2026-09-04.md >/dev/null && ! grep -E '风险规则引擎（[^）]*循环依赖' pm/reports/ARCHIFY-COMPARISON-2026-09-04.md && echo DOC_OK
  ```

**参考文档**：`lib/risk-rules.js`

**活动记录**：
  - 2026-09-06 状态变更 todo→doing：已改 ARCHIFY-COMPARISON 表述
  - 2026-09-06 状态变更 doing→done：验收命令通过；E2E session 同时亮 layer-skip + no-controller-to-storage

---

### <a id="w14-04"></a>✅ W14-04 · [backlog] 文件级循环依赖检测（代码图） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 6h |
| 截止 | — |
| 依赖 | [W14-03](../W14/README.md#w14-03) |
| 负责人 | heyangyan |
| 标签 | core / backlog |


**背景**：文档曾过度承诺循环依赖；语义级调用环难做，文件/包级 import 环是可落地的增量能力。

**目标**：对本轮新增边形成的文件级有向环报 MEDIUM/HIGH finding；全仓历史环不刷屏（增量口径）。

**涉及文件**：`lib/risk-rules.js` `test/`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 构造 A→B→A 本轮新增边可检出
- [ ] 仅历史环不报
- [ ] npm test 覆盖

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  echo 'backlog：实现后补测试命令'
  ```

**参考文档**：`pm/reports/ARCHIFY-COMPARISON-2026-09-04.md`

**活动记录**：
  - 2026-09-06 状态变更 todo→done

---

### <a id="w14-05"></a>✅ W14-05 · [backlog] 能力边界声明：语义缺陷非目标 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 2h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | docs / backlog |


**背景**：用户易期望工具挡住逻辑错/N+1/吞异常；图谱看不见。需在 quickstart/AGENT 明示非目标，避免期望错位。

**目标**：quickstart + 套件 AGENT.md 增加『管什么/不管什么』一节；明确结构验收 vs 代码正确性。

**涉及文件**：`docs/guides/quickstart.md` `templates/`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 文档明确列出非目标清单（逻辑错、N+1、同层循环调用等）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  echo 'backlog：补文档后用 grep 验收'
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-06 状态变更 todo→doing：能力边界声明文档
  - 2026-09-06 状态变更 doing→done：quickstart+AGENT+templates 非目标清单

---

### <a id="w14-06"></a>✅ W14-06 · [backlog] 本地技术债趋势 JSONL（session 追加） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 5h |
| 截止 | — |
| 依赖 | [W14-02](../W14/README.md#w14-02) |
| 负责人 | heyangyan |
| 标签 | pro / backlog |


**背景**：每次 session 是孤立快照；架构师要看跨层边/体量是否复利。本地 JSONL 成本低、可后接图表。

**目标**：session report 向 .av/session-history.jsonl 追加一行（时间、指纹、risk、finding 计数、文件数）；CLI 可打印最近 N 次摘要。

**涉及文件**：`lib/session-report.js` `lib/cli.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 连续两次 report 产生 ≥2 行 JSONL
- [ ] gitignore 约定明确

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  echo 'backlog：实现后补命令'
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-06 状态变更 todo→done

---

### <a id="w14-07"></a>✅ W14-07 · [backlog] 基线变更 PR 评审提示（防洗白） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | — |
| 依赖 | [W08-01](../W08/README.md#w08-01) |
| 负责人 | heyangyan |
| 标签 | team / backlog |


**背景**：基线 JSON 随 PR 提交时，红灯可能被『顺手认领』；缺评审机制。

**目标**：CI/PR 评论在检测到 .av/graph-baseline.json 变更时提示『基线刷新需人工确认』并链到本轮 findings 摘要。

**涉及文件**：`scripts/ci-drift-action.mjs` `lib/pr-comment.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] PR 含基线文件 diff 时评论出现洗白提醒

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  echo 'backlog：实现后补命令'
  ```

**参考文档**：`templates/architecture-check.yml`

**活动记录**：
  - 2026-09-06 状态变更 todo→doing：基线防洗白 PR 评论
  - 2026-09-06 状态变更 doing→done：PR 评论基线防洗白 + CI 接线
