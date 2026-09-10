# W21 任务卡 · backlog

> 阶段：Phase 3 ｜ 周期：— ~ 持续 ｜ 周截止：—
>
> 完成度：0/3 ░░░░░░░░░░ 0%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w21-01"></a>⬜ W21-01 · 语义规则族：枚举穷尽 / 异常契约 / 数据流 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 32h |
| 截止 | — |
| 依赖 | [W20-01](../W20/README.md#w20-01) |
| 负责人 | heyangyan |
| 标签 | rules / semantic / offline / behavior-contract |


**背景**：有了 call 边和行为指纹，就能做比'文件 A import 文件 B'更细的事：枚举缺分支、新异常穿透到入口、HTTP 入口到存储之间没有校验层——这些都是编译器/类型系统没覆盖、但 AST 完全可观测的契约问题。R20 同时解决现有 layer-skip 基于 import 边的误报（同文件有合法调用也有越层调用就全报）。

**目标**：让静态分析覆盖到'行为契约是否自洽'这个层级——不是判定业务对错，而是检测契约变更的传导是否完整。

**涉及文件**：`lib/risk-rules.js` `test/enum-exhaustiveness.test.js` `test/exception-drift.test.js` `test/input-to-storage.test.js` `test/sensitive-sink.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 新增 4 条语义规则：R18 enum-exhaustiveness（MEDIUM，枚举新增成员后 switch/match 站点缺分支逐条列出，有 default 降 LOW）；R19 exception-contract-drift（MEDIUM，throw-set 新增 + 沿 call 边到入口无捕获，Python/Java 高精度、JS 启发式标 confidence）；R20 input-to-storage-unguarded（HIGH，route→storage 存在 call 路径且中途无校验/service 节点——layer-skip 的 call 边精判版）；R21 sensitive-sink-untested（MEDIUM，金额/权限/鉴权/加密 sink 指纹变化 + 无测试）；R18/R19 目标精度 ≥ 0.8，R20/R21 目标 ≥ 0.6；全部新规则默认 report-only 一个版本，精度达标后再进退出码；零新增第三方依赖

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/enum-exhaustiveness.test.js test/exception-drift.test.js test/input-to-storage.test.js test/sensitive-sink.test.js
  ```
  ```bash
  npm test
  ```

**参考文档**：`docs/plans/behavior-contract-plan/behavior-contract-plan.html`

**活动记录**：
  - （暂无）

---

### <a id="w21-01a"></a>⬜ W21-01a · 枚举穷尽 + 异常契约漂移规则 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 16h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | rules / enum / exceptions / offline |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] R18：enum/TS 联合类型/Python Enum/Java enum 新增成员后，沿 call 边与引用边找全部 switch/match/if-else 链站点，未覆盖新成员的站点逐条列出（文件+行号）；有 default/catch-all 分支时降级为 LOW；五语言 fixture 各含正反向用例。R19：函数 throw-set 新增异常类型，沿 call 边向上追溯到 controller/entrypoint 层，无对应 catch/except 处理则报'新异常可能穿透到入口'；Python/Java 异常类型显式高精度，JS 抛字符串/自定义类启发式标 confidence

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w21-01b"></a>⬜ W21-01b · 数据流精判 + 敏感 sink 规则 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 16h |
| 截止 | — |
| 依赖 | [W21-01a](../W21/README.md#w21-01a) |
| 负责人 | heyangyan |
| 标签 | rules / dataflow / offline / heuristic |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] R20 input-to-storage-unguarded：route handler 到 storage sink 之间存在 call 路径且路径上无 DTO/校验/service 层节点 → HIGH；现有 import 版 layer-skip 保留为粗筛，call 版作为精判；R21 sensitive-sink-untested：金额计算/权限校验/鉴权/加密相关 sink（命名+注解启发式，标 confidence）行为指纹变化且无测试变更 → MEDIUM；两条规则 report-only 一个版本观察，实测精度达标后调级

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）
