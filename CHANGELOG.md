# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## \[0.3.2] — 2026-09-02

### Fixed

- **修复 npm 安装后 CLI 静默退出（hotfix）**：`bin/arch-viewer.js` 仅 `require('../lib/cli.js')`，而 CLI 入口被 `require.main === module` 守卫包裹，经 npm shim 加载时不执行 `main()`，导致 `arch-viewer` 任何命令都无输出、退出码 0。改为显式调用 `main()` 并处理 Promise/异常退出码。

- 新增 `test/cli-bin.test.js`：spawn 真实 CLI 冒烟 4 例（help、未知命令、无 Key 精修、init+generate+check 全流程），防回归。

## \[Unreleased]

## \[0.3.1] — 2026-09-01

### Added

- **Pro 本地版**：控制台登记本机文件夹、手动/定时 `check --drift`、控制台红绿灯、可选企业微信推送。不需要 GitHub/Gitee。

- **试用到期策略**：手动「现在检查」仍可用；自动检查与企业微信需许可证。小白教程 [docs/PRO-LOCAL.md](docs/PRO-LOCAL.md)、`/local-pro.html`。

## \[0.3.0] — 2026-09-01

### Added

- **Pro 最小收费闭环**：账号注册/登录（7 天试用）、仓库 Webhook、托管 `arch-viewer check --filled --drift` 并在 GitHub/Gitee PR 上发表/更新红灯或绿灯评论；Stripe Checkout（可选）与 HMAC 许可证兑换、管理员开通。控制台 `/account.html`。见 [docs/PRO-SAAS.md](docs/PRO-SAAS.md)。

- 部署骨架：`.env.example`、`Dockerfile`/`docker-compose.yml` 挂载 `ARCH_PRO_SECRET` 等 Pro 环境变量

### Changed

- `web/lib/clone.js` 新增 OAuth/PAT 带 token 克隆 + 指定分支（Pro 私有仓支持）；`web/server.js` 同时挂载 Community + Pro 路由，`ARCH_PRO_SECRET` 缺失时 `/api/pro/*` 返回 503 而非 crash

- 落地页定价区「Pro · 规划中」→ 可注册试用；导航与 footer 新增 Pro 控制台/支持入口；README 指向托管评论对接说明

- CI 漂移模板安装命令统一为 `arch-viewer@^0.2.1`（Community 0.2.1 基线）

## \[0.2.1] — 2026-09-01

### Added

- CLI `--refine` / Web `quality: "refine"`：与骨架共用 `generateToDirAsync`；无 Key 严格失败（CLI exit 1 / Web 401）

- 落地页「我有 API Key」表单、模式徽标、本机记住 Key、内联状态条

- 客户可复制的漂移 CI 模板：[templates/architecture-check.yml](templates/architecture-check.yml)

- 精修后自动剥离 Init 模板页脚，避免 `check --filled` 误伤

### Changed

- **主卖点叙事**：出图是诱饵，PR 漂移红灯才是订阅楔子（README / 落地页 / COMMERCIAL）

- Gitee 优先占位与文案；DeepSeek 认证失败映射为用户可读 401

- AGENT.md：成品图必须删除模板占位页脚

## \[0.2.0] — 稳定性与多语言基线

### Added

- **多语言锚点识别**：Java（Spring Boot `*Application.java` 入口、`import` 解析、Maven/Gradle 源根深度、同包兄弟可达性）、Python（`wsgi.py`/`asgi.py`/`manage.py`/`celery_app.py` 入口）、TypeScript（bullmq 队列文件角色纠偏）；锚点引擎现覆盖 Go/Rust/Java/Python/TypeScript/前端工程

- **其余 5 视图协议闸门**：C4Context/C4Container/C4Component、classDiagram、deployment flowchart 统一经 `lintDiagram` 校验——mermaid 头类型、边端点已声明（无幽灵节点）、孤儿节点、节点数上下限、节点描述路径核查；LLM 生成后不合格自动修复一轮并择优保留

- 离线打包 Mermaid 11.6.0（`vendor/mermaid.min.js`），扩展 Preview 与网页分享页不再请求 CDN

- NOTICE：Apache-2.0 声明 + Mermaid MIT 署名

- 商业化文档：Pro ¥29/月无限生成；Team ¥999/年/仓库；卖点改为防漂移 / 自动同步 / 团队规范

- WBS 项目管理：`pm/` 下 46 个可执行任务、周五周报脚本、Gitee Webhook

- Playwright E2E 冒烟（落地页双语、六视图 Tab、离线 Mermaid、漂移样例）

- 英文落地页 `?lang=en` + [README.en.md](README.en.md) + [MVP.md](MVP.md) 使用说明

### Changed

- **产品运行时与** **`eval/`** **解耦**：orch 编排引擎（`lib.js`/`run.js`/`block-gen.js`）迁入 `lib/orch/` 成为产品代码；`eval/orch/` 改为反向引用垫片。产品 `lib/` 不再对 `eval/` 有任何运行时硬依赖，`eval/` 可独立增删而不影响发布产物

- 扩展 Webview CSP 仅允许本地脚本，去掉 `cdn.jsdelivr.net`

### 稳定性说明（0.2.x 基线）

- **稳定面（semver patch 内兼容）**：CLI 命令（`init`/`generate`/`validate`/`check`）、kit 目录结构（6 张视图 `.md` + `architecture_visualized.html` + 配置）、`lib/scan.js` 清单字段、漂移校验协议

- **Beta（可能 minor 调整）**：LLM 生成质量依赖外部模型，输出结构随提示词/闸门迭代演进；`lib/orch/` 内部函数签名不保证跨 minor 稳定，仅 `lib/index.js` 与 CLI 为公共入口

- **内部开发件（不随发布承诺）**：`eval/`、`pm/`、`scripts/`、`test/` 为开发/评测工具，不属于产品运行时

## \[0.1.0] — 2026-08-29

### Added

- Apache-2.0 License；[COMMERCIAL.md](COMMERCIAL.md) 划清 Community / Pro 边界

- Cursor/VS Code 扩展命令：Init、Generate、Preview、Validate、Copy Agent Prompt

- 网页版 Community MVP：`npm run web`（落地页、样例/路径生成、`/p/<id>` 分享预览）

- CLI `arch-viewer`：同一套生成 + Rel 校验 + 代码漂移检测

- Preview 通过 `__ARCH_INLINE_SOURCES__` 注入图源，扩展内无需本地 HTTP

- CI：单测 + 60 秒演示脚本；`eval/demo-drift` 锁定坏图必须失败

### Added（展示样例）

- 官方演示仓 `examples/showcase-shop`（Coffee Shop）：compose / 前后端 / 领域类 / Worker / K8s

- 静态分享页 `/samples/showcase/` 与漂移红灯页 `/samples/drift-fail/`（`npm run bake:samples`）

