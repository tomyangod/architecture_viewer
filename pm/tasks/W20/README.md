# W20 任务卡 · backlog

> 阶段：Phase 3 ｜ 周期：— ~ 持续 ｜ 周截止：—
>
> 完成度：3/3 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w20-01"></a>✅ W20-01 · 行为指纹与测试耦合 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 24h |
| 截止 | — |
| 依赖 | [W19-01](../W19/README.md#w19-01) |
| 负责人 | heyangyan |
| 标签 | behavior-contract / testing / offline / quality |


**背景**：impl-surface 已提取函数体的调用/异常/await/控制流摘要，但仅用作'实现是否变化'的布尔标记。升级为集合 diff 就能回答'这个函数干的事变了没有'。加上 test-index 补上验证证据维度——'变了行为但没动测试'是逻辑正确性相关性最高的静态信号。

**目标**：让 AV 在 AI 改了行为但没改测试时主动喊停，并标出高影响面 × 无验证网的最危险组合。

**涉及文件**：`lib/extract/behavior-fingerprint.js` `lib/extract/test-index.js` `lib/risk-rules.js` `lib/session-report.js` `test/behavior-fingerprint.test.js` `test/test-index.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 每个导出函数有行为指纹：call-set、throw-set、await-set、分支数、return 点数、sink-set（存储写入/HTTP 请求/消息发送，命名+注解启发式，标 confidence）；纯重命名/文件移动指纹不变不报；测试文件单独建索引（test-index），通过 import 关系 + 命名约定建立 tests 边；新增 R16 behavior-changed-no-test（MEDIUM，行为指纹变化 × 无关联测试变更）与 R17 behavior-changed-broad-impact（HIGH，指纹变化 × 下游 ≥10 × 无测试变更）；test-index 不进分层图、不进基线噪声、不影响外部依赖统计；R16/R17 在本仓 session 历史回放精度 ≥ 0.7

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/behavior-fingerprint.test.js test/test-index.test.js
  ```
  ```bash
  node --test test/risk-impact.test.js
  ```

**参考文档**：`docs/plans/behavior-contract-plan/behavior-contract-plan.html`

**活动记录**：
  - 2026-09-09 状态变更 todo→doing
  - 2026-09-09 状态变更 doing→done

---

### <a id="w20-01a"></a>✅ W20-01a · 行为指纹计算与 diff 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 12h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | extraction / offline / behavior-contract |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 复用 impl-surface 产出，从布尔标记升级为 call-set/throw-set/await-set/分支数/return 点数/sink-set 六维集合指纹；重命名/移动/格式化不改变指纹不报；指纹变化触发 diff 记录并接入 risk-rules 输入；sink 识别用命名+注解启发式并标 confidence 字段

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - 2026-09-09 状态变更 todo→doing
  - 2026-09-09 状态变更 doing→done

---

### <a id="w20-01b"></a>✅ W20-01b · 测试索引与 R16/R17 规则 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 12h |
| 截止 | — |
| 依赖 | [W20-01a](../W20/README.md#w20-01a) |
| 负责人 | heyangyan |
| 标签 | rules / testing / offline |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] test-index 独立存储，不进分层图/基线/外部依赖统计；通过 import 关系为主、命名约定为辅建立 tests 边（测试实体 → 被测生产实体）；R16：导出函数行为指纹变化 × 无关联测试文件本轮变更 → MEDIUM，附建议与最近测试路径；R17：指纹变化 × 下游 ≥10 × 无测试变更 → HIGH，有测试变更降 INFO；低置信度测试关联自动降 LOW；规则 report-only 一个版本观察后调级

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - 2026-09-09 状态变更 todo→done
