# W19 任务卡 · backlog

> 阶段：Phase 3 ｜ 周期：— ~ 持续 ｜ 周截止：—
>
> 完成度：3/3 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w19-01"></a>✅ W19-01 · 调用图与签名契约（行为契约审查地基） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 32h |
| 截止 | — |
| 依赖 | [W16-03](../W16/README.md#w16-03) |
| 负责人 | heyangyan |
| 标签 | architecture / call-graph / offline / behavior-contract |


**背景**：当前图里只有文件级 import 与声明级关系（继承/实现/类型引用），没有函数级调用边；SEMANTIC_NODE_FIELDS 只比对方法名，参数/返回值变化报告无感知。这是行为契约审查全部后续工作的地基——没有 call 边，R16–R21 都跑不起来。

**目标**：让 AV 能回答'这个函数改了签名，哪些调用点会炸'，并把调用断裂作为最高优先级红灯。

**涉及文件**：`lib/extract/call-graph.js` `lib/extract/jsts.js` `lib/extract/python.js` `lib/extract/java.js` `lib/extract/go.js` `lib/diff-graph.js` `lib/risk-rules.js` `test/call-graph.test.js` `test/signature-break.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 五语言（JS/TS/Python/Java/Go）增量构建 call 调用边，跨文件经 import 绑定解析，动态调用落 unresolved 并标 low confidence；实体签名指纹（paramCount/paramTypes/returnTypes/optionalParams）纳入 SEMANTIC_NODE_FIELDS，diff 明细列出参数/返回值变化；新增 R14 signature-break（HIGH，导出函数签名变更 + call 边反查调用点实参不匹配）与 R15 unresolved-call-cluster（LOW）；增量构建耗时增加 ≤ 30%；R14 在 eval 真实仓回放精度 ≥ 0.9；零新增第三方依赖（复用 tree-sitter）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/call-graph.test.js test/signature-break.test.js test/analyzers*.test.js
  ```
  ```bash
  node --test test/session-report-stats-graph.test.js
  ```

**参考文档**：`docs/plans/behavior-contract-plan/behavior-contract-plan.html`

**活动记录**：
  - 2026-09-09 状态变更 todo→doing
  - 2026-09-09 状态变更 doing→done

---

### <a id="w19-01a"></a>✅ W19-01a · 五语言 call 调用边提取（增量 + import 绑定） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 16h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | extraction / call-graph / offline / tree-sitter |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] JS/TS call_expression、Python call、Java method_invocation、Go call_expression 均生成 call 边（caller 实体 → callee 实体）；同文件直接解析，跨文件经 import 绑定（JS named/default、Python from-import、Java import、Go package 选择器）；解析不了的动态调用落 unresolved-call 节点 + confidence: low；只对变更文件闭包（changed + 反向依赖）增量构建，不全量；基线不存储完整 call 图，仅存储签名指纹

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - 2026-09-09 状态变更 todo→done

---

### <a id="w19-01b"></a>✅ W19-01b · 签名指纹进 diff + R14/R15 规则 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 16h |
| 截止 | — |
| 依赖 | [W19-01a](../W19/README.md#w19-01a) |
| 负责人 | heyangyan |
| 标签 | rules / diff / offline / high-signal |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] SEMANTIC_NODE_FIELDS 纳入签名指纹字段；diff 变更明细列出 params: N→M、returnTypes 变化；R14 signature-break：导出函数签名变化后，沿 call 边反查全部调用点，实参个数/类型不匹配的逐条列出为证据；有断裂调用点 → HIGH，全匹配 → INFO；R15 unresolved-call-cluster：变更文件内 unresolved 调用密度异常 → LOW 提示；规则走 evaluateRisk 统一管线，CLI/HTML/JSON 三端一致

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - 2026-09-09 状态变更 todo→done
