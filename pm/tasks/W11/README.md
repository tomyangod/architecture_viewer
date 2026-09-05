# W11 任务卡 · 按仓库年费 / PDF 导出 / 数据复盘

> 阶段：Phase 2 ｜ 周期：2026-11-09 ~ 2026-11-13 ｜ 周截止：2026-11-13
>
> 完成度：3/3 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w11-01"></a>✅ W11-01 · Team 按仓库年费方案落地（¥999/年/仓库） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 5h |
| 截止 | 2026-11-13 |
| 依赖 | [W05-02](../W05/README.md#w05-02) |
| 负责人 | heyangyan |
| 标签 | biz / team |


**背景**：席位制 ¥99–199/人/月在国内中小团队接受度极低；按仓库计费与「仓库内嵌」定位天然契合。

**目标**：落地页与 billing 支持 ¥999/年/仓库商品；购买后解锁 Team 特性（CI 托管评论、rules 包、共享图库占位）。

**涉及文件**：`web/lib/billing.js` `web/public/index.html` `COMMERCIAL.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 落地页定价表含 Team ¥999/年/仓库
- [ ] billing 流程可下单（沙箱或真实）
- [ ] COMMERCIAL.md 同步

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "999" web/public/index.html && grep -q "999" COMMERCIAL.md && echo TEAM_OK
  ```

**参考文档**：`COMMERCIAL.md`

**活动记录**：
  - 2026-09-04 状态变更 todo→doing：开工：Team ¥999/年/仓库下单与权益占位
  - 2026-09-04 状态变更 doing→done：落地页 Team ¥999/年/仓库可下单；POST /api/billing/team-order 沙箱可开通；admin grant plan=team；COMMERCIAL.md 同步。TEAM_OK。

---

### <a id="w11-02"></a>✅ W11-02 · PDF 导出与演示模式 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 5h |
| 截止 | 2026-11-13 |
| 依赖 | [W02-02](../W02/README.md#w02-02) |
| 负责人 | heyangyan |
| 标签 | viewer / feature |


**背景**：「给老板/评审会用」是高频场景；六视图合订 PDF 与全屏演示是付费感知功能。

**目标**：Viewer 内一键导出六视图合订 PDF；演示模式全屏切换、快捷键导航。

**涉及文件**：`architecture_visualized.html` `web/public/app.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 导出 PDF 含六视图与标题页
- [ ] 演示模式可全屏、左右键切 tab

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "pdf\|print" architecture_visualized.html && echo PDF_OK
  ```

**参考文档**：`architecture_visualized.html`

**活动记录**：
  - 2026-09-05 undefined

---

### <a id="w11-03"></a>✅ W11-03 · 用户行为数据复盘（留存/漏斗/定价） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 3h |
| 截止 | 2026-11-13 |
| 依赖 | [W04-04](../W04/README.md#w04-04)、[W09-01](../W09/README.md#w09-01) |
| 负责人 | heyangyan |
| 标签 | metrics / biz |


**背景**：用真实数据替换调研基准：安装→激活→试用→付费漏斗、生成频率、留存。

**目标**：复盘文档给出数据、与基准对比、3 条功能/定价调整建议。

**涉及文件**：`pm/retrospective-w11.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 含漏斗各环节数字
- [ ] 含 ≥3 条有数据支撑的调整建议

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/retrospective-w11.md && echo RETRO11_OK
  ```

**参考文档**：`pm/metrics.md`

**活动记录**：
  - 2026-09-05 状态变更 todo→doing：写 retrospective-w11 基于首周 npm 与漏斗接线
  - 2026-09-05 状态变更 doing→done：retrospective-w11：漏斗数字+3 条建议
