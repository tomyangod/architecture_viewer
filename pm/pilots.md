# 真实项目试点记录

> W08-03 验收文档：至少 1 个真实仓库接入架构漂移检查，连续 2 周记录结果。

> **重要声明**：以下试点为作者自有仓（v18），属于**工程验证**（验证工具能否运行、检测是否准确），**不是客户验证**（不验证外部团队付费意愿）。6–8 周付费验证计划见 [pilot-validation-6w.md](plans/pilot-validation-6w.md)。

## 试点仓库

| 字段 | 值 |
|------|-----|
| 仓库名称 | v18 — 多源舆情智能采集与监控平台 |
| 路径 | `/Users/yanheyang/Desktop/v18` |
| 语言 | Python + Node.js（前端 JS） |
| 规模 | 147 文件 · 1181 类型 · 1419 节点 · 2416 边 · 91 外部依赖 |
| 接入日期 | 2026-09-05 |
| 架构图状态 | 已有 6 张图（C4 Context/Container/Component、Block、Class、Deployment），上次更新约 2026-07-11 |

## Week 1 检查（2026-09-05）

### 命令

```bash
arch-viewer check /Users/yanheyang/Desktop/v18/architecture_viewer \
  --drift --filled --repo /Users/yanheyang/Desktop/v18
```

### 结果汇总

| 维度 | 数量 | 说明 |
|------|------|------|
| 协议错误 | 0 | — |
| 协议警告 | 2 | c4-component.md 子图缺少 UpdateLayoutConfig |
| 漂移（代码有、图缺失） | 24 | 全部为 module 类型 |
| 漂移（图有、代码不存在） | 0 | — |

### 漂移明细

**BmccMediaSpider-main 系列（11 项）**：BmccMediaSpider-main 本身及其 10 个子模块（base / cmd_arg / constant / database / libs / media_platform / model / proxy / readmes_of_all_modules / store）。

- 判定：**潜在误报**。该目录是引入的第三方爬虫项目（完整子项目），不属于 v18 自有架构。工具无法区分「项目内模块」与「vendored 子项目」，全部标记为漂移。
- 改进建议：支持 `.arch-viewer-ignore` 或 kit 配置中声明 `externalDirs`，将 vendored 目录排除。

**后端模块（2 项）**：`backend/core`、`backend/services`。

- 判定：**真实漂移**。架构图仅记录了 `sentiment_server.py` 等顶层后端入口，未体现 backend/ 下的核心逻辑与服务层。
- 建议：在 Block Diagram L2 层补充 backend/core 和 backend/services 节点。

**前端 JS 模块（2 项）**：`js/core`、`js/features`。

- 判定：**真实漂移**。架构图前端仅画了 index.html / dashboard.html，未体现 JS 模块化结构。
- 建议：在 Block Diagram L1 层补充 js/core 和 js/features。

**数据采集子模块（1 项）**：`data_collection/reliability`。

- 判定：**真实漂移**。L4 数据采集层未包含可靠性模块。

**调试/实验模块（1 项）**：`debug/wechat_platform_automation`。

- 判定：**边界情况**。debug/ 目录通常是实验性代码，可标注为 intentionally excluded。

**顶层工具模块（7 项）**：`blackbox`、`cmd_arg`、`csv_generator`、`database`、`debug`、`libs`、`runtime`。

- 判定：**混合**。`database` 和 `runtime` 是核心基础设施，应入图；`blackbox`（黑盒验证）可选择性入图；`cmd_arg`、`csv_generator`、`libs`、`debug` 属工具/辅助层，可标注为 intentionally excluded。
- 建议：至少补充 `database` 和 `runtime` 到 Block Diagram 基础设施层。

### 误报 / 漏报评估

| 类别 | 数量 | 占比 |
|------|------|------|
| 真实漂移（应修复） | 7 | 29% |
| 潜在误报（vendored 子项目） | 11 | 46% |
| 边界/可选 | 6 | 25% |
| 漏报 | 0 | — |

**历史潜在误报占比**：11/24，约 46%（含 vendored 子项目）；不等同于客户验证中的实际误报率。
**漏报率**：未测量。首轮没有独立 N/M/K 抽检分母，不能据此声称无漏报或排除后误报率为零。

### 结论

1. 工具能运行并发现部分真实漂移；首轮不能证明无漏报。
2. 主要改进点：支持排除 vendored/第三方子项目目录，降低误报。
3. v18 项目的架构图需更新，至少补充 7 个真实漂移模块。

## Week 2 检查（2026-09-12，未执行）

> 计划：修复上述 7 个真实漂移后复检，验证漂移项是否清零；同时验证 vendored 排除配置是否生效。
> 状态：**功能已落地（W24-02）**。vendored 排除见仓库根 `.arch-viewer-ignore` 或 `.av/layers.json` 的 `externalDirs`。09-11 已有本地克隆复检记录：19 个自有模块保留、BmccMediaSpider 为 0，见 [验证计划](plans/pilot-validation-6w.md#v18-复检记录2026-09-11)。这不等于 Week 2 连续使用或外部客户验证。

## 改进追踪

| 日期 | 问题 | 状态 |
|------|------|------|
| 2026-09-05 | vendored 子项目（BmccMediaSpider-main）被误报为漂移 | 记录，待产品评估 |
| 2026-09-05 | 工具模块（libs/debug/cmd_arg）是否应入图 | 建议增加 `externalDirs` 配置 |

## Team 私有化意向（W12-01）

报价与 SLA：[docs/commercial/team-onprem.md](../docs/commercial/team-onprem.md)。**书面**意向（邮件 / 报价确认 / 订单号）才记入下表；口头不算。

| 日期 | 组织 / 项目 | 联系渠道 | 凭证类型 | 档位 | 状态 |
|------|-------------|---------|---------|------|------|
| 2026-09-05 | v18 舆情平台 | 作者自有仓 | — | — | **技术试点**（W08-03），**不是**付费意向 |

> 空着的付费行待种子用户或对公客户按 `docs/commercial/team-onprem.md` 模板回信后补。补上第一行书面凭证后本卡方可标 done。
