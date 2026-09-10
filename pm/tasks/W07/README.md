# W07 任务卡 · 增量生成引擎 / architecture-rules.yaml

> 阶段：Phase 2 ｜ 周期：2026-10-12 ~ 2026-10-16 ｜ 周截止：2026-10-16
>
> 完成度：2/2 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w07-01"></a>✅ W07-01 · 增量生成引擎（缓存 + 变动模块重生成） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 8h |
| 截止 | 2026-10-16 |
| 依赖 | [W03-01](../W03/README.md#w03-01) |
| 负责人 | heyangyan |
| 标签 | core / pro / cost |


**背景**：全量生成慢且费 token；Pro「无限生成」的成本可控性依赖增量；这也是「自动同步」卖点的引擎基础。

**目标**：扫描结果与图源做哈希比对，仅对变动模块重生成提示词/内容；eval 脚本对比全量耗时与 token 规模。

**涉及文件**：`lib/generate.js` `lib/cache.js` `lib/scan.js` `eval/REPORT.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 无改动时二次 Generate 命中缓存，耗时下降 ≥80%
- [ ] 单模块改动时仅相关视图更新，其余视图内容不变
- [ ] eval 报告记录增量 vs 全量耗时/token 对比，规模下降 ≥50%

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node lib/cli.js generate && node lib/cli.js generate && npm test
  ```

**参考文档**：`lib/generate.js`

**活动记录**：
  - 2026-09-04 undefined

---

### <a id="w07-02"></a>✅ W07-02 · architecture-rules.yaml 团队制图规范（差异化支点） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 8h |
| 截止 | 2026-10-16 |
| 依赖 | [W03-01](../W03/README.md#w03-01) |
| 负责人 | heyangyan |
| 标签 | core / moat / pro |


**背景**：调研结论：Mermaid 官方扩展与 Cursor 都不会做「团队架构纪律」；这是平台不愿做的重管理功能，是第一个差异化支点。

**目标**：支持 architecture-rules.yaml：节点命名正则、分层归属、禁止跨层依赖、Rel 白名单；Validate 对违规亮红灯。

**涉及文件**：`lib/rules.js` `architecture-rules.example.yaml` `lib/validate.js` `test/validate.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] example 规则文件含命名规则、跨层禁止、Rel 白名单三类示例
- [ ] 违规夹具运行 check 退出码非 0 且报出规则名
- [ ] 合规夹具通过
- [ ] npm test 通过

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node lib/cli.js check . --rules architecture-rules.example.yaml || echo '需违规夹具验证'
  ```
  ```bash
  npm test
  ```

**参考文档**：`docs/plans/market-evaluation/market-evaluation.html` `lib/validate.js`

**活动记录**：
  - 2026-09-04 状态变更 todo→doing
  - 2026-09-04 状态变更 doing→done：architecture-rules.yaml：命名正则 + 分层归属 + 禁止跨层 + Rel 白名单；check --rules 违规夹具红灯报规则名，合规夹具通过。lib/rules.js 无第三方 YAML 依赖。
