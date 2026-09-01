# Architecture Viewer 商业化 · 项目总览

> 单一事实源：[`project.config.json`](../project.config.json) + [`tasks/tasks.json`](./tasks/tasks.json)（46 个任务）。
> 本页由 `node pm/scripts/wbs-cards.mjs` 自动生成。

## 全局进度

| 指标 | 数值 |
|---|---|
| 总任务 | 46 |
| ✅ 已完成 | 6（13%） |
| 🔵 进行中 | 0 |
| 🔴 阻塞 | 0 |
| ⚠️ 逾期 | 0 |

## 阶段与里程碑

### Phase 0 · 合规与包装

- 覆盖周次：W1–W2
- 里程碑：可打包、可离线、商业化文档定稿
- 准出闸门：vsix 本地侧载成功 + 断网 Preview 正常

### Phase 1 · 上架 × 获客并行

- 覆盖周次：W3–W6
- 里程碑：双 Marketplace 上架 + 首批 100 安装
- 准出闸门：Marketplace 可安装 + Free/Pro 门禁可演示

### Phase 2 · 差异化（收费理由落地）

- 覆盖周次：W7–W12
- 里程碑：防漂移闭环 + 首笔 Pro 付费 + Team 试点意向
- 准出闸门：PR 漂移评论在真实仓库运行 + 首笔付费到账

### Phase 3 · 壁垒层（backlog）

- 覆盖周次：W13–W13
- 里程碑：架构资产管理器
- 准出闸门：多仓聚合门户可用

## 周计划导航

| 周 | 主题 | 截止 | 任务数 | 完成 | 状态 |
|---|---|---|---|---|---|
| [W01](./tasks/W01/README.md) | 离线化 / 合规 / 商业文档 | 2026-09-04 | 6 | 6/6 | ✅完成 |
| [W02](./tasks/W02/README.md) | 打包脚手架 / Webview 回归 / 账号骨架 | 2026-09-11 | 6 | 0/6 | 🟢正常 |
| [W03](./tasks/W03/README.md) | 生成质量打磨 / 五仓回归 | 2026-09-18 | 3 | 0/3 | 🟢正常 |
| [W04](./tasks/W04/README.md) | 获客启动：教程文 / README / 种子博主 | 2026-09-25 | 4 | 0/4 | 🟢正常 |
| [W05](./tasks/W05/README.md) | 付费门禁 / 支付通道（国庆假期，轻量） | 2026-10-02 | 3 | 0/3 | 🟢正常 |
| [W06](./tasks/W06/README.md) | 双 Marketplace 上架 / 落地页 / 冲榜 | 2026-10-09 | 4 | 0/4 | 🟢正常 |
| [W07](./tasks/W07/README.md) | 增量生成引擎 / architecture-rules.yaml | 2026-10-16 | 2 | 0/2 | 🟢正常 |
| [W08](./tasks/W08/README.md) | CI Action 漂移检测 + PR 评论 | 2026-10-23 | 3 | 0/3 | 🟢正常 |
| [W09](./tasks/W09/README.md) | 付费转化优化 / 首笔 Pro | 2026-10-30 | 3 | 0/3 | 🟢正常 |
| [W10](./tasks/W10/README.md) | 多语言漂移精度打磨 / PR 评论 v2 | 2026-11-06 | 2 | 0/2 | 🟢正常 |
| [W11](./tasks/W11/README.md) | 按仓库年费 / PDF 导出 / 数据复盘 | 2026-11-13 | 3 | 0/3 | 🟢正常 |
| [W12](./tasks/W12/README.md) | Team 私有化试点 / 12 周复盘 | 2026-11-20 | 2 | 0/2 | 🟢正常 |
| [W13](./tasks/W13/README.md) | 壁垒层 backlog（不排死期） | — | 5 | 0/5 | 🟢正常 |

## 常用命令

```bash
node pm/scripts/wbs.mjs status                 # 查看实时看板（含阻塞/逾期高亮）
node pm/scripts/wbs.mjs sync                   # 依赖联动校验（阻塞下游标红、逾期检查）
node pm/scripts/wbs.mjs cards                  # 重新生成本页与每周任务卡
node pm/scripts/wbs.mjs report                 # 生成本周周报（pm/reports/weekly/）
node pm/scripts/wbs.mjs report --week W08      # 指定周次周报
node pm/scripts/wbs.mjs set W01-01 doing       # 更新任务状态：todo|doing|blocked|done
node pm/scripts/wbs.mjs set W01-01 blocked --reason "等支付账号"
node pm/scripts/wbs.mjs set W07-01 doing --progress 60
node pm/scripts/wbs.mjs verify                 # 校验 tasks.json 完整性（依赖/验收/截止）
node pm/scripts/wbs.mjs webhook                # 启动 Gitee Webhook 服务（默认 :3910）
```

## 自动化规则

1. **周五周报**：每周五 17:00（北京时间）定时生成，统计完成率、延期风险、阻塞高亮与下周计划 → `pm/reports/weekly/`。
2. **阻塞联动**：任一任务标记 blocked，其所有下游任务（传递依赖）在看板与任务卡中自动标红；解除阻塞后自动恢复。
3. **Gitee Webhook**：Push 事件中 commit message 含任务号即自动更新进度——
   - `完成 W01-01` / `closes W01-01` / `done W01-01` → 任务标记 done；
   - `W07-01 60%` → 更新进度百分比；
   - 仅提及任务号 → todo 自动转 doing 并记录活动日志。
   - 服务：`node pm/scripts/wbs.mjs webhook`（端口 3910，路径 `/gitee-webhook`，密钥读环境变量 `GITEE_WEBHOOK_SECRET`）。

## 周报与记录

- 周报目录：[`pm/reports/weekly/`](./reports/weekly/)
- 指标台账：[`pm/metrics.md`](./metrics.md)
- Webhook 日志：`pm/reports/webhook.log`
