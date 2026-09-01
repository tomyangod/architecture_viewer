# W03 任务卡 · 生成质量打磨 / 五仓回归

> 阶段：Phase 1 ｜ 周期：2026-09-14 ~ 2026-09-18 ｜ 周截止：2026-09-18
>
> 完成度：0/3 ░░░░░░░░░░ 0%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w03-01"></a>⬜ W03-01 · Generate 命令质量打磨与协议内置 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 8h |
| 截止 | 2026-09-18 |
| 依赖 | [W02-01](../W02/README.md#w02-01) |
| 负责人 | heyangyan |
| 标签 | core / quality |


**背景**：当前 generate 产出确定性骨架，LLM 填图靠用户手动贴 AGENT.md；生成后 Rel 校验已在命令内串联但错误提示需更可操作。

**目标**：AGENT.md 协议内置进扩展（生成时自动写入套件）；Generate 完成后自动跑校验并在输出中给出可点击的修复提示。

**涉及文件**：`lib/generate.js` `lib/kit.js` `src/extension.js` `AGENT.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] Init 出的套件内含 AGENT.md
- [ ] Generate 对 eval 三仓 0 protocol error
- [ ] 校验失败时错误信息含视图名与具体 Rel 缺失项
- [ ] node lib/cli.js eval 全 PASS

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node lib/cli.js eval
  ```
  ```bash
  npm test
  ```

**参考文档**：`lib/generate.js` `AGENT.md` `eval/REPORT.md`

**活动记录**：
  - （暂无）

---

### <a id="w03-02"></a>⬜ W03-02 · 五仓回归评测（含前端与 Java/Go） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 4h |
| 截止 | 2026-09-18 |
| 依赖 | [W03-01](../W03/README.md#w03-01) |
| 负责人 | heyangyan |
| 标签 | eval / quality |


**背景**：现有 3 个评测仓偏 Python/Node；上架宣传需要多语言覆盖证据，尤其前端与编译型语言。

**目标**：eval/repos.json 扩到 5 仓（新增 1 前端仓、1 Java 或 Go 仓），eval 报告记录通过率与典型问题。

**涉及文件**：`eval/repos.json` `eval/REPORT.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] eval 报告含 5 个仓库结果
- [ ] PASS ≥ 4/5，失败仓有问题归因记录
- [ ] 漂移检测对人为改动夹具能报错

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node lib/cli.js eval && grep -c "PASS" eval/REPORT.md
  ```

**参考文档**：`eval/REPORT.md`

**活动记录**：
  - （暂无）

---

### <a id="w03-03"></a>⬜ W03-03 · 侧栏树视图 + 右键刷新此视图 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 5h |
| 截止 | 2026-09-18 |
| 依赖 | [W02-03](../W02/README.md#w02-03) |
| 负责人 | heyangyan |
| 标签 | extension / ux |


**背景**：命令面板对新用户不够直观；侧栏树是 VS Code 扩展的标准交互，也为后续单视图增量刷新铺路。

**目标**：活动栏新增 Architecture Viewer 图标，树列六视图；单击打开 Preview 并定位 tab，右键支持「刷新此视图」「在编辑器中打开图源」。

**涉及文件**：`src/extension.js` `src/treeView.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 活动栏出现图标，树展示 6 个视图节点
- [ ] 单击节点打开 Webview 并切换到对应 tab
- [ ] 右键「刷新此视图」触发单视图重新生成

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "TreeDataProvider\|registerTreeDataProvider" src/extension.js src/treeView.js 2>/dev/null && echo TREE_OK
  ```

**参考文档**：`src/extension.js`

**活动记录**：
  - （暂无）
