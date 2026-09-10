# W12 任务卡 · Team 私有化试点 / 12 周复盘

> 阶段：Phase 2 ｜ 周期：2026-11-16 ~ 2026-11-20 ｜ 周截止：2026-11-20
>
> 完成度：1/2 █████░░░░░ 50%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w12-01"></a>🔵 W12-01 · Team 私有化试点（1 个付费意向） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 进行中（进度 70%） |
| 工时预估 | 6h |
| 截止 | 2026-11-20 |
| 依赖 | [W11-01](../W11/README.md#w11-01)、[W08-03](../W08/README.md#w08-03) |
| 负责人 | heyangyan |
| 标签 | team / milestone / biz |


**背景**：私有化报价单页 + 离线包是 B 端敲门砖；从种子用户/试点仓库中转化。

**目标**：私有化报价与交付说明页；≥1 个书面付费试点意向（邮件/合同/订单均可）。

**涉及文件**：`docs/commercial/team-onprem.md` `pm/pilots.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] team-onprem.md 含报价档位、交付物、SLA 说明
- [ ] pilots.md 记录 ≥1 个书面意向凭证

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f docs/commercial/team-onprem.md && echo ONPREM_OK
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-05 状态变更 todo→doing：写私有化报价与交付说明，意向凭证待真实书面回复
  - 2026-09-05 状态变更 doing→doing：报价/交付/SLA 已发布；书面付费意向待真实回信，不虚构凭证

---

### <a id="w12-02"></a>✅ W12-02 · 12 周复盘 + Phase 3 设计稿 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | 2026-11-20 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | retro / planning |


**背景**：壁垒层进入设计：多仓聚合、跨仓依赖图、规范模板市场。

**目标**：12 周复盘（目标达成率、收入、数据）+ Phase 3 技术设计稿（数据模型、API、里程碑）。

**涉及文件**：`pm/retrospective-12w.md` `docs/plans/phase3-design.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 复盘含三大指标：安装、付费、收入
- [ ] 设计稿含多仓聚合数据模型与跨仓依赖图方案

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/retrospective-12w.md && test -f docs/plans/phase3-design.md && echo RETRO12_OK
  ```

**参考文档**：`docs/plans/market-evaluation/market-evaluation.html`

**活动记录**：
  - 2026-09-05 状态变更 todo→doing：12 周快照复盘 + Phase3 设计稿
  - 2026-09-05 状态变更 doing→done：12w 快照复盘+phase3-design 多仓/跨仓模型
