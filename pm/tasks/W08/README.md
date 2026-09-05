# W08 任务卡 · CI Action 漂移检测 + PR 评论

> 阶段：Phase 2 ｜ 周期：2026-10-19 ~ 2026-10-23 ｜ 周截止：2026-10-23
>
> 完成度：3/3 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w08-01"></a>✅ W08-01 · GitHub/Gitee Action：漂移检测 + PR 评论标注 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 8h |
| 截止 | 2026-10-23 |
| 依赖 | [W07-01](../W07/README.md#w07-01) |
| 负责人 | heyangyan |
| 标签 | ci / pro / moat |


**背景**：PR 里自动标注漂移是持续付费理由的核心动作；Mermaid Chart 已做 PR-aware review，本任务要做到 C4 六视图粒度。

**目标**：Action 在 PR 上运行 check --drift --rules，把漂移项评论到 PR（视图名、缺失模块、建议动作）；demo-drift 夹具必须触发红灯评论。

**涉及文件**：`.github/workflows/architecture-drift.yml` `scripts/ci-drift-action.mjs` `.gitee/`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 提测 PR 上出现漂移评论，内容含视图名与缺失项
- [ ] demo-drift 夹具对应 PR 检查失败（红灯）
- [ ] 无漂移时评论通过或不评论（可配置）
- [ ] Gitee 侧有等价 pipeline 配置或脚本

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f .github/workflows/architecture-drift.yml && test -f scripts/ci-drift-action.mjs && echo ACTION_OK
  ```

**参考文档**：`.github/workflows/ci.yml` `eval/demo-drift`

**活动记录**：
  - 2026-09-04 状态变更 todo→doing
  - 2026-09-04 状态变更 doing→done：Action 跑 check --drift --rules，PR 评论含视图名/缺失项/建议动作；demo-drift 与 rules-violate 锁红灯；无漂移默认不评论。GitHub + Gitee 等价 pipeline。

---

### <a id="w08-02"></a>✅ W08-02 · rules 校验接入 CLI Validate 与 CI 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 3h |
| 截止 | 2026-10-23 |
| 依赖 | [W07-02](../W07/README.md#w07-02) |
| 负责人 | heyangyan |
| 标签 | core / cli |


**背景**：rules 只写文件用户感知弱；CLI Validate 与 CI 必须同源。扩展 Validate 接入暂缓。

**目标**：CLI validate 输出 rules 违规项；CI Action 同步执行 rules 检查。

**涉及文件**：`lib/validate.js` `.github/workflows/architecture-drift.yml`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] CLI validate 结果含 rules 段
- [ ] CI 对 rules 违规红灯
- [ ] 文档说明 rules 文件写法

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "rules" lib/validate.js && npm test && echo RULES_CLI_OK
  ```

**参考文档**：`lib/validate.js`

**活动记录**：
  - 2026-09-04 状态变更 todo→done：CLI check 输出 --- rules --- 段；validateDir 结果含 rules；architecture-drift.yml 对 rules 违规红灯；写法见 architecture-rules.example.yaml 与 README。

---

### <a id="w08-03"></a>✅ W08-03 · 真实项目周更图试点 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 80%） |
| 工时预估 | 3h |
| 截止 | 2026-10-23 |
| 依赖 | [W08-01](../W08/README.md#w08-01) |
| 负责人 | heyangyan |
| 标签 | pilot / proof |


**背景**：「至少 1 个真实项目周更图」是 Phase 2 验收；也是博客/销售的最强素材。

**目标**：1 个真实仓库接入 Action，连续 2 周 PR 有漂移检查行为，记录误报/漏报。

**涉及文件**：`pm/pilots.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] pilots.md 记录试点仓库、接入日期、每周结果
- [ ] 连续 2 周有检查记录

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/pilots.md && echo PILOT_OK
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-05 状态变更 todo→done（Week 1 完成）。试点 v18 仓库，24 漂移项（7 真实+11 误报+6 边界）。Week 2 复检待 2026-09-12。
