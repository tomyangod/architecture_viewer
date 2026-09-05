# W10 任务卡 · 多语言漂移精度打磨 / PR 评论 v2

> 阶段：Phase 2 ｜ 周期：2026-11-02 ~ 2026-11-06 ｜ 周截止：2026-11-06
>
> 完成度：2/2 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w10-01"></a>✅ W10-01 · 多语言漂移检测精度打磨（Java/Go/前端） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 8h |
| 截止 | 2026-11-06 |
| 依赖 | [W07-01](../W07/README.md#w07-01)、[W08-01](../W08/README.md#w08-01)、[W03-02](../W03/README.md#w03-02) |
| 负责人 | heyangyan |
| 标签 | core / quality |


**背景**：漂移误报多了用户会关 CI；编译型语言与前端框架的隐式依赖需要扫描规则补强。

**目标**：三类语言各 1 仓的 eval 中，漂移检测误报率 <20%（人工判定），漏报有归因。

**涉及文件**：`lib/scan.js` `lib/generate.js` `eval/REPORT.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] eval 报告含误报率统计
- [ ] 误报率 <20%，漏报项有 issue 记录

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node lib/cli.js eval && npm test
  ```

**参考文档**：`eval/REPORT.md`

**活动记录**：
  - 2026-09-04 undefined

---

### <a id="w10-02"></a>✅ W10-02 · PR 漂移评论 v2（定位视图/行 + 修复 prompt） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 5h |
| 截止 | 2026-11-06 |
| 依赖 | [W08-01](../W08/README.md#w08-01) |
| 负责人 | heyangyan |
| 标签 | ci / ux / pro |


**背景**：评论只说「漂移了」不可执行；给出具体位置和一键修复 prompt 才形成闭环。

**目标**：评论含：视图名、图源文件与行号、缺失/多余元素、可直接粘贴给 Cursor 的修复 prompt。

**涉及文件**：`scripts/ci-drift-action.mjs`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 测试 PR 评论含行号定位与修复 prompt 代码块
- [ ] prompt 粘贴到 Cursor 可产出修复 diff（人工验证 1 例）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "prompt\|Prompt" scripts/ci-drift-action.mjs && echo PRV2_OK
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-05 undefined
