# W23 任务卡 · backlog

> 阶段：Phase 3 ｜ 周期：— ~ 持续 ｜ 周截止：—
>
> 完成度：4/5 ████████░░ 80%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w23-01"></a>🔵 W23-01 · 对话内 3 行结构验收 verdict（HTML 降为深挖链接） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 进行中（进度 80%） |
| 工时预估 | 8h |
| 截止 | 2026-09-17 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | ux / session / mcp / v0.12 |


**背景**：日常节奏仍要求用户打开 .av/session-report.html 才能知道好不好。成熟产品把结论推到对话/编辑器；HTML 应是可选深挖。

**目标**：session report（CLI/MCP）默认输出 ≤3 行 verdict：灯色 + 风险/变更计数；红/橙附最严重 1 条（文件+规则）；HTML 仅作可选链接。不删 start/report API。

**涉及文件**：`lib/session-verdict.js` `lib/green-light.js` `mcp/server.js` `lib/cli.js` `test/session-verdict.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] formatSessionVerdict 对 none/low/medium/high 均产出 ≤3 行主文案
- [ ] 红/橙必须含最严重 finding 的 file（若有）与 title/rule，不能只说「有问题」
- [ ] MCP av_session_report 返回 verdict 字段；message 以 verdict 为主，不再要求必须打开 HTML
- [ ] CLI session report 在结尾打印 verdict；--open 仍可用但不作为默认叙事
- [ ] node --test test/session-verdict.test.js 与相关绿灯文案回归通过

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/session-verdict.test.js test/green-light-copy.test.js
  ```

**参考文档**：`docs/guides/quickstart.md` `.cursor/projects/.../canvases/session-ritual-ux-plan.canvas.tsx`

**活动记录**：
  - 2026-09-10 状态变更 todo→doing：v0.12 先做对话 verdict
  - 2026-09-10 状态变更 doing→doing：formatSessionVerdict + MCP/CLI 已接线，测试绿

---

### <a id="w23-02"></a>✅ W23-02 · Cursor hook spike：sessionStart / stop 行为验证 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 8h |
| 截止 | 2026-09-18 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | hooks / cursor / spike / v0.12 |


**背景**：方案假设 stop 可 followup_message、绿灯返回 {} 不循环；Cursor 文档语焉不详，不能直接按 Sigrid 模式开工。

**目标**：用最小 hooks.json 验证 sessionStart/stop 入参、stdout 契约、followup 是否触发、红灯限速策略是否可行；产出 1 页 spike 报告后再写正式 hook。

**涉及文件**：`docs/plans/cursor-hooks-spike.md` `templates/cursor-hooks.example.json`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] spike 报告写明：可用事件、stdin 字段、followup_message 实测行为、循环风险与节流建议
- [ ] 示例 hooks.json 可复制；不默认写入用户全局配置
- [ ] 明确 P0 是否依赖 stop followup，或改走 Agent 规则 + pre-commit 兜底

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f docs/plans/cursor-hooks-spike.md && test -f templates/cursor-hooks.example.json && echo SPIKE_OK
  ```

**参考文档**：`lib/setup.js`

**活动记录**：
  - 2026-09-10 状态变更 todo→doing：开始 Cursor hook spike
  - 2026-09-10 状态变更 doing→done：spike 文档+example hooks+stdin dry-run 测试通过；P0 主强制=stop

---

### <a id="w23-03"></a>✅ W23-03 · 默认基线 = git HEAD（缓存 + commit hash 失效） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 40h |
| 截止 | 2026-09-24 |
| 依赖 | [W23-01](../W23/README.md#w23-01) |
| 负责人 | heyangyan |
| 标签 | baseline / git / session / v0.12 |


**背景**：graph-baseline.json 手拍快照硬编码于多处；用户不知何时刷新。舆情仓已整目录忽略 .av/；本仓仍细粒度忽略且可提交基线——两套真相源。

**目标**：有 git 时 session 对照 HEAD 结构图（.av/graph-head.json 缓存，commit hash 失效）；无 git 回退现快照。accept=commit（主路径）；保留显式 accept/session start 给非 git 与「先记下来」场景。不物理删除 start/report。

**涉及文件**：`lib/session-baseline.js` `lib/cli.js` `mcp/server.js` `lib/workspace.js` `test/session-baseline-git.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 有 .git 的仓：不手动 session start 也能 session report（对照 HEAD 缓存）
- [ ] commit 后缓存失效并重扫；日常 stop/report 路径用缓存 HEAD 图 ↔ 工作区图
- [ ] 无 git 仓回退 graph-baseline.json；测试覆盖两种路径
- [ ] verdict 标明对照点（HEAD / snapshot）与是否含未提交改动
- [ ] 现有 session/CI/PR 相关测试保持绿或按新语义更新

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/session-baseline-git.test.js test/session-verdict.test.js
  ```

**参考文档**：`lib/session-paths.js` `lib/pr-comment.js`

**活动记录**：
  - 2026-09-10 状态变更 todo→doing：开始 git HEAD 基线实现
  - 2026-09-10 状态变更 doing→done：git HEAD 缓存基线已接线；无 git 回退快照；测试绿

---

### <a id="w23-04"></a>✅ W23-04 · av_guard + setup 写入多宿主 hooks（主强制） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 24h |
| 截止 | 2026-09-26 |
| 依赖 | [W23-02](../W23/README.md#w23-02)、[W23-03](../W23/README.md#w23-03) |
| 负责人 | heyangyan |
| 标签 | mcp / setup / hooks / v0.12 |


**背景**：setup 今天只写 mcp.json + magicPrompt 口令；Agent 可忘。W23-02 spike 结论：主强制=stop+followup；sessionStart 只做 env/副作用，不依赖 additional_context；Cloud 无 sessionStart 有 stop；loop_limit=1。通用核：MCP `av_guard` + CLI `session guard`；Cursor/Claude 为 adapter，DeepSeek Harness 等靠 AGENTS.md / MCP。

**目标**：新增 av_guard（ensure baseline + 出本轮 verdict）；`setup --project` 写入 Cursor/Claude hooks + 跨宿主规则；红灯仅 loop_count=0 时 followup；绿灯 stdout={}；start/report 保留。

**涉及文件**：`mcp/server.js` `lib/setup.js` `lib/setup-project.js` `lib/session-gate.js` `templates/cursor-hooks.example.json` `test/setup-hooks.test.js` `test/mcp.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [x] av_guard 在无基线时自动 ensure，再返回与 report 同级的 verdict
- [x] arch-viewer setup --project 写入 Cursor/Claude hooks + AGENTS.md 等
- [x] magicPrompt / 规则不再要求用户背 start→开 HTML→再 start
- [x] 红灯同 finding 不二次 followup；绿灯 hook stdout 为 {}（若平台支持）
- [x] MCP 工具列表仍含 start/report（心智收敛不等于物理删除）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node --test test/setup-hooks.test.js test/mcp.test.js
  ```

**参考文档**：`docs/plans/cursor-hooks-spike.md`

**活动记录**：
  - 2026-09-10 状态变更 todo→doing：跨平台 av_guard + setup 强制层
  - 2026-09-10 状态变更 doing→done：av_guard + session guard + multi-host setup --project；验收测试绿

---

### <a id="w23-05"></a>✅ W23-05 · Quickstart / README 换叙事：说话→看灯→commit 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 8h |
| 截止 | 2026-09-27 |
| 依赖 | [W23-01](../W23/README.md#w23-01)、[W23-03](../W23/README.md#w23-03) |
| 负责人 | heyangyan |
| 标签 | docs / ux / v0.12 |


**背景**：文档主路径仍教拍照仪式；与 v0.12 产品形态冲突。

**目标**：主叙事改为装一次后只提需求；验收在对话；commit=接受。start/report/开 HTML 降为附录/高级。

**涉及文件**：`README.md` `README.en.md` `docs/guides/quickstart.md` `lib/setup.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [x] README 三步速览不再以 session start → report → 开 HTML 为主路径
- [x] Quickstart 日常闭环以 verdict / commit 表述；拍照仪式进附录
- [x] magicPrompt 与文档一致

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -n "说话\|verdict\|commit" docs/guides/quickstart.md README.md | head
  ```

**参考文档**：`pm/reports/W15-07-beginner-flow.md`

**活动记录**：
  - 2026-09-10 状态变更 todo→done：README/Quickstart 主路径改为说话→verdict→commit；拍照仪式进附录；magicPrompt 对齐
