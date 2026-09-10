# 文档目录

按用途分目录。日常用产品，优先看 **guides/**。

## guides/ — 用户指南

| 文档 | 说明 |
|------|------|
| [quickstart.md](./guides/quickstart.md) | **唯一**通用教程：安装、会话门、读报告、CI；含六视图 / 迷你仓（§10） |
| [beginner-guide/](./guides/beginner-guide/index.html) | 小白图文攻略（装 Node + 看样例 + 迷你仓红灯；通用流程链 Quickstart） |
| [MVP.md](./guides/MVP.md) | 最小可行产品：30 秒看效果 + 三条使用路径 |
| [welcome.html](./guides/welcome.html) | `setup` 后打开的引导页 |
| [IMPACT-REPORT.md](./guides/IMPACT-REPORT.md) | 影响面报告 |
| [LAYERED-STYLE.md](./guides/LAYERED-STYLE.md) | 分层图视觉通解 |

## demos/ — 演示与成片

| 文档 | 说明 |
|------|------|
| [MCP-DEMO-publicopinionmonitor.md](./demos/MCP-DEMO-publicopinionmonitor.md) | 舆情仓实战附录（实测 + `/tmp` 串门；通用流程见 guides/quickstart） |
| [MCP-DEMO-publicopinionmonitor-short.md](./demos/MCP-DEMO-publicopinionmonitor-short.md) | 同上 1 页速查 |
| [DEMO.md](./demos/DEMO.md) | Init → Generate → Preview → CI 演示清单 |
| [landing-new.html](./demos/landing-new.html) | 单文件零依赖落地页 |
| [demo-script.md](./demos/demo-script.md) | 60 秒 Demo 分镜 |
| [demo.mp4](./demos/demo.mp4) / [demo.gif](./demos/demo.gif) | 成片与预览动图 |
| [blog/](./demos/blog/) | 外发实战文 |

## commercial/ — 商业与开通

| 文档 | 说明 |
|------|------|
| [COMMERCIAL.md](./commercial/COMMERCIAL.md) | 开源边界与 Community / Pro / Team 定价 |
| [billing.md](./commercial/billing.md) | 收款 → 核验 → 开通 SOP |
| [support.md](./commercial/support.md) | 支持渠道 |
| [invoice.md](./commercial/invoice.md) | 对公开票 |
| [PRO-SAAS.md](./commercial/PRO-SAAS.md) / [PRO-LOCAL.md](./commercial/PRO-LOCAL.md) | Pro SaaS / 本地 Pro |
| [team-onprem.md](./commercial/team-onprem.md) | 私有化报价 |
| [landing-deploy.md](./commercial/landing-deploy.md) | 落地页部署 |
| [npm-publish.md](./commercial/npm-publish.md) | npm 发布 SOP |

## labs/ — 实验配置

| 路径 | 说明 |
|------|------|
| [oss-labs/](./labs/oss-labs/) | Uptime Kuma / listmonk / changedetection 的 `architecture.layers.json` 样例（用法见 [quickstart §6.4](./guides/quickstart.md#64-练手演示仓与开源仓可选)） |

## ops/ — 运营草稿

| 文档 | 说明 |
|------|------|
| [promo-drafts.md](./ops/promo-drafts.md) | 推广文案草稿 |
| [feedback-tracking.md](./ops/feedback-tracking.md) | 发版反馈跟踪表 |

## plans/ — 内部设计与规划稿

产品规划 HTML、技术设计、一次性分析报告。**不是**用户上手文档。

- [phase3-design.md](./plans/phase3-design.md)
- [COMMERCIAL-v2.md](./plans/COMMERCIAL-v2.md)
- [behavior-contract-plan/](./plans/behavior-contract-plan/)
- [ai-visibility-plan/](./plans/ai-visibility-plan/)
- [asset-manager-plan/](./plans/asset-manager-plan/)
- [market-evaluation/](./plans/market-evaluation/)
- [stage-c-plan/](./plans/stage-c-plan/)
- [dependency-removal-summary/](./plans/dependency-removal-summary/)
- [p0-dynamic-dependency-detection.html](./plans/p0-dynamic-dependency-detection.html)

---

仓库根目录的 [README.md](../README.md) 是对外入口；改文档链接时请同步更新本索引与根 README。

## 根目录兼容入口

为避免旧链接失效，仓库根与 `docs/` 根下保留少量跳转页与符号链接（如根目录 `COMMERCIAL.md` / `MVP.md`、`docs/billing.md` → `commercial/`、`demo.mp4` → `demos/`、`welcome.html` → `guides/`）。**请以本索引中的正式路径为准**，不要继续往仓库根或 `docs/` 根堆新文档。
