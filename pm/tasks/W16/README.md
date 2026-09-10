# W16 任务卡 · backlog

> 阶段：Phase 3 ｜ 周期：— ~ 持续 ｜ 周截止：—
>
> 完成度：2/6 ███░░░░░░░ 33%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w16-01"></a>⬜ W16-01 · 小范围分发：3 个真实仓试点邀请 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 8h |
| 截止 | — |
| 依赖 | [W15-08](../W15/README.md#w15-08) |
| 负责人 | heyangyan |
| 标签 | distribution / pilot |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 邀请 3 个不同规模/语言的真实项目接入 session 门，连续使用 2 周，收集使用频率、误报率、是否愿意持续用

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w16-02"></a>✅ W16-02 · 退出码契约标准化（0/1/2/3/4） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 3h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | cli / api-stability |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] CLI session report/check/diff 命令统一退出码：0 通过 / 1 架构门未通过 / 2 参数配置错 / 3 扫描解析失败 / 4 基线不存在或失效；文档写明

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/exit-codes.test.js test/cli-exit-contract.test.js
  ```

**参考文档**：`lib/exit-codes.js` `lib/cli.js` `docs/guides/quickstart.md` `docs/guides/SESSION-GUIDE.md`

**活动记录**：
  - 2026-09-09 状态变更 todo→done：session report/check/diff 统一退出码 0/1/2/3/4；CLI 契约测试与文档已写明

---

### <a id="w16-03"></a>undefined W16-03 · 可插拔分析器架构：内置 + Import Linter + dependency-cruiser 适配器 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | undefined（进度 85%） |
| 工时预估 | 12h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | architecture / pluggable / quality |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 统一分析接口并接入 session report；共享分层加载及错误处理；准确映射契约语义；真实 Python storage→controller HIGH、JS controller→service 合法/controller→storage HIGH、循环依赖一条多来源证据，CLI/MCP/HTML/JSON 一致。历史证据：2026-09-08 dependency-cruiser 17.4.3 / Import Linter 2.15 生成禁止导入配置并跑通 controller→storage 红灯及修复回绿，全套 670 passed / 0 failed / 1 skipped。对照两份补测报告再次复跑定向测试：176 项，170 passed / 0 failed / 6 skipped（真实工具未提供）；第一份报告的全量明细为 672 passed / 0 failed / 7 skipped，而非 679 全通过。本轮另用真实 builtin 循环 finding 加模拟外部证据验证双向环一条多来源。完整清单仍未通过，证据与缺口见 docs/guides/SESSION-GUIDE.md。

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w16-03a"></a>✅ W16-03a · 分析器接口抽象 + 统一中间格式 + 内置适配器包装（零行为变化） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | — |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | architecture / pluggable / quality |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 统一 nodes/edges/violations/evidence 接口；内置适配器复用同一 current 图并保留团队规则和 finding 字段；合并仅去重同义规则及规范化路径，保留来源；CLI/MCP/IDE/多仓报告统一入口，未启用外部时保持内置行为；执行失败不返回假绿灯

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w16-03b"></a>undefined W16-03b · dependency-cruiser 适配器（JS/TS 增强） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | undefined（进度 85%） |
| 工时预估 | 4h |
| 截止 | — |
| 依赖 | [W16-03a](../W16/README.md#w16-03a) |
| 负责人 | heyangyan |
| 标签 | architecture / pluggable / quality |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 已完成工具/配置检测、真实 JSON 转换、增量过滤、对象分层配置建议和 controller→storage 报告红灯→修复回绿；历史真实适配器测试验证 controller→service 合法。新增共享加载器接入建议生成、cycleMembers 及共享规则身份；本轮实际调用 builtin 双向环检测，与模拟外部证据合并为一条并保留两个来源，原简单环缺口已有修复。待完成：将名称映射限制到可证明的 AV 跳层语义，补齐真实 dependency-cruiser 循环在 CLI/HTML/JSON 中一条多来源的完整报告验收；本轮真实工具测试跳过，不能用模拟结果替代。

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w16-03c"></a>undefined W16-03c · Import Linter 适配器（Python 增强） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | undefined（进度 85%） |
| 工时预估 | 4h |
| 截止 | — |
| 依赖 | [W16-03a](../W16/README.md#w16-03a) |
| 负责人 | heyangyan |
| 标签 | architecture / pluggable / quality |


**背景**：undefined

**目标**：undefined

**涉及文件**：

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 已完成真实文本/多行链解析、null repo 与增量过滤修复、对象分层禁止导入草稿、历史 CLI/MCP/HTML/JSON controller→storage 红灯→修复回绿。新增共享加载器接入、layers→cross-layer-violation/普通 forbidden→forbid-cross-layer 映射及层级标签，storage→controller fake 工具测试覆盖路径和增量过滤。待完成：以可验证配置类型替代名称/正文猜测，不能仅凭契约名含 Architecture Viewer 判定 layer-skip；解决共享规则仍受 importLinterContract/importChain 去重键隔离的问题；用真实 layers 契约补齐 storage→controller HIGH、相关文件增量及 CLI/HTML/JSON 一致验收。

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：


**参考文档**：—

**活动记录**：
  - （暂无）
