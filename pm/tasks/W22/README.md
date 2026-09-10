# W22 任务卡 · backlog

> 阶段：Phase 3 ｜ 周期：— ~ 持续 ｜ 周截止：—
>
> 完成度：0/3 ░░░░░░░░░░ 0%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w22-01"></a>⬜ W22-01 · AI 事实接地评审（可选在线分析器） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 24h |
| 截止 | — |
| 依赖 | [W21-01](../W21/README.md#w21-01) |
| 负责人 | heyangyan |
| 标签 | ai / llm / online / optional / pluggable |


**背景**：L0–L3 产出的是硬事实，'这个变更在业务上可能意味着什么'需要推理。推理必须接地——用 eval 盲评已经验证过的纪律（低温、JSON 约束、随机盲序），加上机制层的证据引用强制丢弃，把幻觉风险压到可控。LLM 编排策略（见方案附录 B）：确定性层（import 图/diff/退出码）绝不交给概率模型；概率层只在 confidence: low 的四个场景补位——unresolved-call 猜目标、框架语义角色判断、无 grammar 语言 fallback、业务影响推断。LLM 提出候选，机器验证；验证不过直接丢弃。

**目标**：让 AI 只说有证据支撑的话，把业务影响推断作为 MEDIUM 级参考，不越界。所有 LLM 调用经 lib/orch/finding-review.js 单点路由，不在各规则内部直连模型。

**涉及文件**：`lib/analyzers/llm-review.js` `lib/orch/finding-review.js` `mcp/server.js` `test/llm-review.test.js` `eval/finding-blind-review.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 新增 llm-review 分析器走 UIF 插件体系，isAvailable = 有 DEEPSEEK_API_KEY 或用户配置 LLM，无 Key 离线跳过与现有付费门控一致；输入为事实包（R14–R21 候选 finding + 相关 call 链 + 签名 diff + 测试缺口 + 行号证据窗口 ±15 行），不是代码全文；输出强制 JSON schema { verdict, evidenceIds, reasoning }，无 evidenceIds 引用的结论在代码层直接丢弃（机制防幻觉，不靠 prompt）；AI 结论默认 MEDIUM，永不单独触发红灯退出码；MCP 侧扩展 av_explain_finding 支持单条 finding 业务影响推断；建 50 条人工标注 finding 集，AI 评审 precision ≥ 0.8、无证据结论率 = 0；离线模式行为与今天完全一致。设计约束（见方案附录 B）：① 所有 LLM 调用经 lib/orch/finding-review.js 单点路由，不在各规则内部直连模型；② 路由按 confidence: low 四场景分发：unresolved-call 猜目标、框架语义角色判断、无 grammar 语言 fallback 提取、R14–R21 候选 finding 业务影响推断；③ LLM 输出候选必须经代码层确定性复核（AST/文本搜索/import 图），验证不过直接丢弃不报不存；④ 无 Key/超时/限流/格式错误 → 返回空证据 + error 字段，报告照常生成；⑤ 精度回退自动降 report-only

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/llm-review.test.js
  ```
  ```bash
  node eval/finding-blind-review.js --aggregate
  ```

**参考文档**：`docs/plans/behavior-contract-plan/behavior-contract-plan.html#appendix-w22` `lib/orch/lib.js` `eval/orch/blind-edge-7s-vs-orch4.js`

**活动记录**：
  - （暂无）

---

### <a id="w22-01a"></a>⬜ W22-01a · llm-review 分析器 + 事实包构造 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 12h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | ai / pluggable / analyzer |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] llm-review 走 UIF 插件体系（analyze/evidence/isAvailable），与 depcruise/importlinter 同等待遇；事实包构造：R14–R21 候选 finding + 相关 call 链（文件+行号）+ 签名 diff + 测试缺口 + 证据窗口代码片段（±15 行，按行号截取）；复用 lib/orch/lib.js 的 chat/chatJson 与 DEEPSEEK_API_KEY 门控；无 Key 时 evidence.error=null、violations 为空，标记 available=false。低置信度路由入口（见方案附录 B3.1）：所有 LLM 调用经 lib/orch/finding-review.js 单点路由，不在各规则内部直连模型；路由按四场景分发：① unresolved-call 猜目标（输入：调用点 ±15 行 + import 列表 → 候选 { callee, confidence }）；② 框架语义角色判断（输入：签名+装饰器+路径 → 候选 { role, confidence }）；③ 无 grammar 语言 fallback 提取（输入：文件全文 → 候选 { imports, functions }）；④ R14–R21 候选 finding 业务影响推断（输入：事实包 → 候选 { verdict, evidenceIds, reasoning }）。候选验证入口（见方案附录 B3.2）：LLM 输出候选必须经代码层确定性复核——调用目标候选检查 import 图可见性 + AST 存在性；语义角色候选检查路径/命名/装饰器一致性；业务影响候选检查 evidenceIds 全部引用事实包条目；验证通过提升 confidence low→medium，验证不过直接丢弃不报不存

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w22-01b"></a>⬜ W22-01b · 证据引用强制丢弃 + 精度审计 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 12h |
| 截止 | — |
| 依赖 | [W22-01a](../W22/README.md#w22-01a) |
| 负责人 | heyangyan |
| 标签 | ai / qa / evals / safety |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 输出 JSON schema 强制 { verdict: confirmed|risk|false-positive|needs-human, evidenceIds: [...], reasoning }；evidenceIds 必须全部引用事实包条目，无引用或引用不存在的结论直接丢弃（代码层过滤，不靠 prompt）；AI finding 等级固定 MEDIUM，永不触发红灯退出码；av_explain_finding MCP 工具支持单条 finding 业务影响推断，同样强制证据引用；建 50 条人工标注 finding 集做盲评，precision ≥ 0.8、无证据结论率 = 0；复用 eval/orch 盲评 harness。设计约束（见方案附录 B3.4）：① 路由四场景各自独立标注和评测，不混用精度数据；② 没有精度数据的场景不上默认流，只走 --intent 显式调用；③ 每个版本回归跑盲评集，精度回退 → 自动降级为 report-only；④ AI finding 等级固定 MEDIUM，退出码不受 llm-review 影响

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）
