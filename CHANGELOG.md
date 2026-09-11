# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-cn/1.1.0/)，版本号遵循语义化版本。

## \[Unreleased\]

## \[0.12.2-rc.2\] — 2026-09-11

试点候选包，发布到 npm 标签 `next`（不改 `latest`）。正式试点锁定本版本，不与工作区或 `latest` 混用。

### Added

- **仓库级排除**：`.arch-viewer-ignore` 与分层配置的 `externalDirs` 共用目录排除规则；无斜杠按目录名匹配，有斜杠按仓库相对路径匹配。
- **分析范围变化提示**：图谱记录 scope 信息，CLI、MCP、PR 评论与 HTML 区分排除配置变化和真实代码删除。

### Changed

- **Pro 托管增量验收**：对照 PR base 或本地基线，输出结构差分、风险和影响面，替代旧图文漂移检查。
- **Team 申请试点**：验证期只接受人工报价申请，不再创建旧的 ¥999/仓/年订单或自动开通。

### Fixed

- **托管错误状态**：基线不可用、团队规则加载失败时明确返回错误，不以默认规则或自比较伪装成正常验收。
- **扫描完整性**：托管比较前检查 head/base 的读取、解析及分层配置错误，包括持久化基线中的错误统计；扫描范围内的子目录不可读会中止，排除规则命中的目录仍跳过，不能以不完整图给出绿灯。
- **规则子集校验**：损坏 YAML、重复键、未知字段或不完整约束明确报 `RULES_CONFIG_ERROR`；保留合法的列表多空格缩进。CLI/MCP/托管同样拒绝静默丢约束，无配置仍可运行默认规则。
- **排除一致性**：图提取与漂移扫描统一读取支持的 `.gitignore` 简单目录规则及显式排除配置。
- **HEAD 基线范围**：复用工作区分层映射时保留 Git 提交自己的 `externalDirs` / `external_dirs`；新增排除在冷、热缓存下均显示范围变化，旧版 HEAD 图缓存自动失效重建，不刷新快照。

## \[0.12.1\] — 2026-09-10

### Fixed

- **Python 调用图崩溃**：`importlib.import_module(变量)` 产生 `specifier: null` 时，与裸调用 `object: null` 误判为 moduleHit，`resolvePyModule` 对 null 调 `.startsWith` → MCP `-32603` / CLI 退出码 3。现对空 specifier 安全跳过；JS/Go 解析同步防空；`av_session_report` 扫描失败返回 `SCAN_FAILED` 而不打成 Internal Error。

### Added

- **`arch-viewer uninstall`**：对称卸掉用户级 MCP / 本仓 hooks（`--project` 写入物）；`--npm` 卸全局包；`--purge` 清会话报告与快照（保留 `layers.json`）。

## \[0.12.0\] — 2026-09-10

日常路径改为 **说话 → 对话看灯 → git commit**。有 git 时对照 HEAD（commit 即接受）；MCP `av_guard` 为日常入口；HTML / `session start` 降为附录。

### Added

- **对话 verdict（W23-01）**：`session report` / MCP 默认输出 ≤3 行灯色 + 风险计数；红/橙附最严重 1 条；HTML 为可选详情链接。
- **git HEAD 基线（W23-03）**：默认对照 HEAD，缓存 `.av/graph-head.json`（按 commit 失效）；无 git 回退快照。`AV_BASELINE=snapshot` 可钉快照。
- **`av_guard` + `session guard`（W23-04）**：无基线自动 ensure，返回与 report 同级 verdict。CLI `--adapter cursor|claude|generic`。`setup --project` 写入 Cursor stop / Claude Stop / AGENTS.md / CLAUDE.md。
- **退出码契约（W16-02）**：`session report` / `check` / `diff` 统一 `0` 通过 / `1` 架构门未通过 / `2` 参数配置错 / `3` 扫描解析失败 / `4` 基线不存在或失效。`diff` 支持目录或 graph JSON，以及 `--fail-on`。
- **实现差异（函数体）**：JS/TS、Python、Java、Go 函数体指纹。结构图可为 0 变化，报告列出「实现差异」并出 `impl-changed`（info，不阻断）。

### Changed

- **文档叙事（W23-05）**：README / Quickstart / `magicPrompt` 以 `av_guard` + commit 为主路径；拍照仪式进附录。
- **报告契约 schemaVersion 2**：`diff.summary.riskLevel` 删除，改为 `summary.changeScale`。权威风险为 `risk.level`。
- **setup 拆环**：`magicPrompt` / `resolveLauncher` / `mcpServerPath` 抽到 `lib/setup-shared.js`，避免 `setup.js` ↔ `setup-project.js` 循环依赖。

### Security

- **Webview CSP（W02-03）**：Preview 与 Session 报告共用本地 CSP（`default-src 'none'`）。

### Fixed

- **落地页 SOP 测试**：`records landing deploy SOP` 跟随文档迁到 `docs/commercial/landing-deploy.md`。
- **风险字段**：变更规模启发式改名为 `changeScale`。
- **易用性（主仓/worktree）**：MCP `repo` 必须显式传当前工作区绝对路径；不一致时 `PATH_MISMATCH`。
- **`av_status` / idle 竞态 / 防抖 / 动态 import / 再导出 / HTML 顶栏 / `from=session` / `tools/` 分层**：见此前 Unreleased 条目。

### Docs

- 明确 MCP 自动监听 vs CLI 手动 report；版本用 `arch-viewer --version` 核对。
- 风险等级 ↔ 退出码表。

## \[0.11.2\] — 2026-09-08

### Fixed

- **紧急**：补交 `loadSessionRules`（及 session 侧 `forbid_cross_layer` / circular-import）。0.11.1 已引用但未入库，干净安装下 `session report` 会报 `loadSessionRules is not a function`。

## \[0.11.1\] — 2026-09-08

### Fixed

- **Worktree / 工作区根**：MCP `repo` 可省略（默认 cwd）；`setup` 口令不再写死历史绝对路径。
- **`from=session`**：找不到本轮 finding 时返回 `NO_SESSION_FINDING`，禁止静默扫全楼。
- **刷新基线**：清除 `session-report.*` 与 `archify-*`，保留 baseline / layers / history。
- **版本同源**：CLI `--version`/`-V` 与 MCP `serverInfo.version` 均读 `package.json`。
- **HTML 双口径**：`#graph-count` 区分「N 个变更」与「图上含同文件 M 个」。
- **Python import**：`from pkg import mod` 解析到子模块文件，不再误指包 `__init__.py`。

## \[0.11.0\] — 2026-09-05（首次上架 npm latest；此前 registry 停在 0.3.1）

### Added

- **团队制图规范**（`architecture-rules.yaml` / W07-02）：节点命名正则、分层归属、禁止跨层 Rel、Rel 标签白名单。`arch-viewer check --rules` 违规亮红灯并报规则名；未传 `--rules` 时自动读取套件或仓库根的 `architecture-rules.yaml`。示例见 `architecture-rules.example.yaml`。

- **CI 漂移 + 规范 + PR 评论**（W08-01）：`scripts/ci-drift-action.mjs` 在 PR 上运行 `check --drift --rules`，评论含视图名、缺失模块、规则名与建议动作；无漂移默认不评论（`ARCH_DRIFT_COMMENT_ON_PASS=1` 可改）。GitHub：`.github/workflows/architecture-drift.yml`；Gitee 等价：`.gitee/workflows/architecture-drift.yml`。`eval/demo-drift` 与 `eval/fixtures/rules-violate` 锁红灯。

- **Archify IR 适配器**（`lib/export-archify.js`）：把内部图谱转换为 Archify JSON IR（零 I/O 纯函数模块）。id 清洗 `^[a-zA-Z][a-zA-Z0-9_-]*$`；grid 自带 row/col（不依赖自动布局）；稀疏 scope（changed / violations / layers），超限自动降级 layers；不写 sources；connection 稳定 id（base/head 共用 allocator）；boundary 用 kind+label。支持 Before/After 配对导出 + sidecar 元数据（scopeUsed、降级原因、组件/连接计数）。

- **CLI `archify-export` 子命令**：`arch-viewer archify-export [repo] [--scope changed|violations|layers] [--validate] [--archify <path>] [--json]`。导出 IR 三件套（`.base` / `.head` / `.sidecar`）到 `.av/`；可选 `--validate` 调本地 archify CLI 做 `validate` + `compare`。CLI 发现顺序：`--archify` → `ARCHIFY_CLI` 环境变量 → PATH → 仓内 vendor 副本；找不到不报错，提示回退内置渲染器。

- **MCP 工具 `av_archify_export`**：第 6 个 MCP 工具，参数 `repo` / `scope` / `validate`，返回 scopeUsed、是否降级、组件/连接计数、文件路径；校验失败带 `fallback` 提示。

- **渲染器开关**（`lib/archify-export.js`）：`session report` 默认 `--renderer auto`——先导出 IR → validate → compare，成功则主报告换成 Archify HTML，失败静默回退内置渲染器。`--renderer builtin` 可强制内置。CLI 和 MCP 的 `generateSessionReport`（含 watcher 自动报告）走同一条 `finalizeSessionHtml`。内置副本始终保留在 `.av/session-report.builtin.html`。

- **测试 16 条新增**：export-archify 单测 9 条（id 合规、layout、稀疏降级、sidecar 字段）；archify-export 集成测试 7 条（编排、validate、finalize、fallback）；CLI 端到端 3 条；MCP 工具表 5→6 扩充 3 条。全量 260 项 0 失败。

### Docs

- `pm/plans/archify-integration-plan.md`：三模式集成方案（IR 导出 / vendor 渲染 / 生态分发），Phase 1-2 已完成，Phase 3 含 DSH 插件生态（模式 D）。
- `pm/reports/ARCHIFY-COMPARISON-2026-09-04.md`：与 Archify 逐维度对比。
- `pm/reports/STATUS-2026-09-04.md`：项目现状归档（0.11.0 已发 + 0.12 候选）。
- `COMMERCIAL-v2.md`：商业模式修订（学分发不学赞助当主业 / 不改整仓 GPL / 分析不进付费墙）。
- 落地页 60 秒 demo、指标台账、Team 私有化报价、试用漏斗（`auth trial` / 漂移后非阻断 paywall）。

### Added（0.11.0 原条目 · 2026-09-03）

- **MCP 自动闭环（watcher 模式）**：`av_session_start` 后 MCP server 自动监听工作区源码文件（过滤口径与扫描器一致：node\_modules/docs/.venv/dist 等不监听），AI 停下 20 秒（防抖）后**自动生成**架构报告并缓存，无需 Agent 手动触发；新增第 5 个工具 `av_session_changes`——轻量轮询「有没有架构变更」，不生成文件、秒回，Agent 改完代码回复用户前先调它，有变更再调 `av_session_report` 看详情（缓存命中秒回）。新增 `startWatcher` / `stopWatcher` / `getWatcherState` 生命周期管理，工具返回中带 watcher 状态。DeepSeek Harness 示例配置（`mcp/dsh-config.example.yml`）同步更新为自动闭环工作流说明。

- **`arch-viewer setup`** **一键接入**：新增 `lib/setup.js` 与 `setup` 命令——自动检测本机已安装的 AI 工具（Cursor / Claude Code / Claude Desktop / Windsurf / DeepSeek Harness），把 MCP 配置写入对应配置文件，零手工编辑；写入前自动备份原文件（`.bak`），可重复运行、幂等不重复注册；完成后自动打开图文引导页。`npx arch-viewer setup` 是小白推荐入口。

### Changed

- **Before/After 对比图修复**（`lib/session-report.js`）：修复纯新增场景下 Before 视图空白、文件容器布局错位、双图坐标系不统一导致节点位置跳动、changed 过滤器漏过滤、变更边高亮只认单向等问题；变更节点/边在两图中一致高亮。

- **外部依赖 diff 标注 stdlib**（`lib/diff-graph.js`）：新增/移除外部依赖清单携带 `builtin` 标记，Node/Python 标准库模块不再与真第三方依赖混排，「新外部依赖」风险信号噪音降低。

### Docs

- `docs/SESSION-GUIDE.md` 重写为大白话小白指南（拍照片比喻、术语对照表、故意跨层看红灯的分步演示）；README Quick Start 改为 setup 一键入口优先；新增 `docs/MCP-DEMO-publicopinionmonitor.md`（真实仓 MCP 接入演示）与 `docs/welcome.html`（setup 后自动打开的图文引导页）。

## \[0.10.0] — 2026-09-02

### Added

- **MCP Server（Agent 工具化）**：新增 `mcp/server.js`，把 AV 的架构验收能力通过标准 MCP（Model Context Protocol）暴露给 AI Agent（Cursor/Claude/Codex）。暴露且仅暴露 4 个工具：① `av_session_start`（AI 改代码前记录基线 + 自动分层建议）；② `av_session_report`（AI 改完后返回架构 diff + 风险 findings + 影响面 + 退出码语义 HIGH=建议拦截）；③ `av_check_layering`（实时检测当前代码的跨层违规，不需要基线，Agent 改完即可自查）；④ `av_explain_finding`（解释一条违规的结构化事实：谁→谁、哪条边、依据什么分层、修复建议）。刻意不暴露图谱查询工具（谁依赖谁）——那是 codebase-memory-mcp 的主场；AV 给 Agent 的是**判断和结论**，不是原材料。传输协议 stdio JSON-RPC（`2024-11-05`），零依赖、零 API Key、1-2 秒完成。`npm run mcp` 启动；`npx arch-viewer-mcp` 全局可用。13 个测试覆盖工具签名、闭环调用、异常路径和 stdio 协议全链路。

## \[0.9.0] — 2026-09-02

### Added

- **多信号分层推断引擎**：分层识别从「只靠目录名正则」升级为四信号交叉验证——① 用户配置 `.av/layers.json`（最高优先）；② **import 框架语义**（新增 `lib/layer-infer.js`）：sqlalchemy/django.db/mongoose/prisma/gorm/JPA Repository 等判 storage，flask/express/gin/Spring `@RestController`/JAX-RS 等判 controller，`@Entity` 判 domain，`@Service`/celery/NestJS `Injectable` 判 service，pydantic/zod/Bean Validation 判 dto，dotenv/viper/`@Configuration` 判 config；NestJS 按 import 符号区分 `Controller` 与 `Injectable`；③ 目录名/文件名约定（新增 collector/crawler/spider/worker/consumer 词根 → service，dashboard/admin/frontend → component，cache → storage，proxy → util）；④ **结构位置兜底**：高 fan-in 低 fan-out 判 domain、高 fan-out 零 fan-in 判 controller。合并优先级：用户配置 > import(高置信) > 目录名 > import(中置信) > 结构(低置信)；高置信 import 与目录名冲突时以 import 为准并记录 `signalConflicts` 供人工审阅。节点新增 `layerConfidence` / `layerSignal` 字段（不影响指纹算法）。

- **`.av/layers.suggested.json`** **自动生成**：`session start` 与 `extract` 后自动写出按目录聚合的分层建议（layer + confidence + signal + 冲突文件清单），小白零配置——审阅无误无需操作，复制为 `layers.json` 即锁定（`layers.json` 永远优先且不会被覆盖）。

- **真实仓验证**：246 文件的 Python 爬虫仓分层覆盖率从 57% 提升至 92%（此前 `data_collection/` 等非标目录大面积漏判）；新增 `test/layer-infer.test.js` 20 个用例覆盖信号规则、投票合并、冲突标注与 buildGraph 集成。

## \[0.8.0] — 2026-09-02

### Added

- **PR 架构影响面自动评论**：新增 `arch-viewer pr-comment <base-dir> <head-dir> [--post]` 命令与 `lib/pr-comment.js`——把结构 diff、风险发现、反向依赖影响面渲染为 PR 评论 Markdown（变更计数表、新增/移除第三方依赖清单、🔴🟠 风险明细、影响面 Top N）；`--post` 通过 GitHub REST 发布评论，以 marker 注释幂等匹配，同一 PR 重复 push 只 PATCH 更新原评论不刷屏，非 PR 环境自动降级为本地预览。新增 `.github/workflows/architecture-diff.yml`（PR opened/synchronize/reopened 触发，worktree 检出 base.sha 双图谱对比）与 `scripts/pr-comment.js` CI 入口（本仓 dogfood 本地代码）。

- **VS Code 扩展打包与上架前置**：新增 `assets/icon.png`（256×256 扩展图标）；`package.json` 补齐 `icon` / `bugs` / `homepage` / `engines.vscode` / 扩展 keywords，`files` 白名单纳入 `src/` 与 `assets/`；新增 `scripts/build-vsix.js`（vsce 打包前临时摘除 `files` 字段、打包后保证恢复，解决 vsce 不允许 `.vscodeignore` 与 `files` 共存的限制）与 `build:vsix` / `publish:vsix` / `publish:ovsx` 脚本；npm `overrides` 统一 tree-sitter 版本，消除 tree-sitter-java peer 声明导致的依赖树冲突；产出的 `.vsix` 内置 tree-sitter 六平台 prebuilds（darwin/linux/win32 × arm64/x64），安装免编译。

- **新叙事落地页**：`landing-new.html` 单文件零依赖落地页——「AI 写完代码后，自动看清架构变了什么」，会话门 / PR 评论 / 影响面三段式，含终端仿真、PR 评论卡片与 Before/After SVG 图谱示意。

- **文档**：README 按新叙事重写（三种用法：CLI 会话验收门 / VS Code 扩展状态栏角标 / PR 自动评论；Install、Quick Start、风险与影响面算法说明）。新增小白攻略 `docs/beginner-guide/index.html`、演示仓 `examples/beginner-demo/` 与 `scripts/beginner-demo.sh`（`npm run demo:beginner:step`）。

- **VS Code 扩展会话模式（C5）**：新增 `src/extension-session.js`，把会话架构验收能力接入编辑器。新增三个命令——`Architecture Viewer: Session Start`（记录架构基线）、`Session Report`（在侧边 Webview 面板打开 Before/After 架构变更报告）、`Session Refresh`（立即重新分析）。代码变更后 `FileSystemWatcher` 监听源码文件（口径与扫描器一致，忽略 node\_modules/docs/.venv 等，仅判断工作区根之内路径），防抖 `debounceSeconds`（默认 30s）后自动重提取 + diff + 影响面 + 风险分级；状态栏角标实时显示 `+新增 -删除 ~修改` 与风险数，高风险红底、中风险黄底，点击直接打开报告。激活事件改为 `onStartupFinished` 以常驻监听；新增 `architectureViewer.session.*` 配置项（enabled / debounceSeconds / analyzeOnOpen）。核心分析全部复用 `lib/`（extract-graph / diff-graph / risk-rules / impact / session-report），扩展层只做 VS Code API 适配，Webview 报告为自包含 HTML 并注入 CSP。

- **影响面报告导出（C4）**：新增 `impact` 独立命令（`arch-viewer impact <base-dir> <head-dir> [--json]`），不依赖 session 基线，可直接对任意两版代码快照生成影响面报告，适用于 CI/管线中对比 PR 分支；新增 `aggregateImpact` 多仓影响面汇总，`workspace report` 文本输出逐仓显示「影响:被改N 波及M」并给出跨仓聚合总数，`--json` 输出含每仓 impact 摘要；多仓 `reportRepo` 接入 B4 影响面驱动风险分级。

- **文档**：`docs/IMPACT-REPORT.md` 影响面报告使用文档（概念、三种使用方式、JSON 结构、风险联动、算法说明、边界限制）。

## \[0.7.0] — 2026-09-02

### Added

- **影响面驱动的风险分级（B4）**：`evaluateRisk` 接收 `impact` 参数，新增 broad-impact 规则——被改实体波及 ≥10 下游时产生 MEDIUM finding，≥20 升为 HIGH；removed-type 规则按下游数量升降级（<3 降 LOW，≥10 升 HIGH）。`diff` 与 `session report` 两处调用均自动传入 impact 数据。

## \[0.6.0] — 2026-09-02

### Added

- **架构变更增量审计（影响面分析）**：`lib/impact.js` 沿 wiring 边（import/extends/implements/field-type 等）反向 BFS，计算每个被改实体（新增/删除/修改/重命名）的直接与间接下游；base 图（旧调用方，如删除前）与 head 图（新调用方）反向边取并集。`diff` 与 `session report` 文本报告新增「影响面」段（被改实体数、受影响下游数、每个被改实体直接下游 Top5），HTML 报告新增「影响面」卡片（直接/间接计数 + 直接下游清单）。

- **变更簇穿透**：同一次会话中多个互相依赖的文件同时变更时，BFS 穿透被改实体集群，只报告集群边界之外真正被波及的下游，避免「改了整条链却显示无影响」。

### Changed

- **风险口径统一**：`diff` 文本汇总不再用旧计数启发式标「风险等级」（曾出现 0 风险发现却报 HIGH 的矛盾），改为「变更规模：小/中/大」，风险等级一律以风险引擎 findings（Risk level）为准；`diff` 命令文本输出同步接入风险发现段。

- **扫描覆盖修复**：`bin/` 不再默认跳过——Node 项目 `bin/` 是 CLI 入口源码（.NET/Java 构建产物 `bin/` 中只有 .dll/.class 等非源码文件，扩展名过滤自然排除）。

## \[0.3.1] — 2026-09-01

### Added

- **Pro 本地版**：控制台登记本机文件夹、手动/定时 `check --drift`、控制台红绿灯、可选企业微信推送。不需要 GitHub/Gitee。

- **试用到期策略**：手动「现在检查」仍可用；自动检查与企业微信需许可证。小白教程 [docs/PRO-LOCAL.md](docs/PRO-LOCAL.md)、`/local-pro.html`。

## \[0.5.0] — 2026-09-02

### Added

- **AI 会话架构可见性（阶段 A/B）**：tree-sitter 多语言结构提取（JS/TS、Python、Go、Java、Vue、Svelte），`arch-viewer extract` 输出代码→架构图谱（文件/类型/函数节点 + import/extends/implements/field-type 等依赖边 + 外部依赖），静态分析保确定性、零 API Key 离线可用。

- **架构 Diff**：`arch-viewer diff <base> <head>` 对比两版图谱，量化节点/边/类型/包/外部依赖增删改与跨层违规；重命名归并（同文件同 kind + 名称相似度配对，避免误报删+增）；已有文件内新增函数检测（子实体集合对比）；开发资产目录（test/eval/examples/docs）与压缩文件自动排除。

- **会话报告**：`arch-viewer session start` 记录基线，`session report` 生成离线自包含 HTML 前后对比报告（分层泳道图、节点状态色：新增绿/删除红/修改黄/重命名青）+ 风险发现（跨层违规、层级穿透、类型删除、新外部依赖、高扇出、孤立实体）。默认「仅变更」高信号视图，未变更项折叠；文本报告默认折叠 declared-in/defined-in 归属边，`--all` 展开，`--open` 自动打开浏览器。

- **习惯门工作流**：基线（`.av/graph-baseline.json`，可提交为团队基线）→ AI 编码 → `session report` 验收 → 确认后 `session start` 刷新基线；报告本地生成不入库。

- **产品精修路由** `lib/refine-route.js`：`--refine` / `quality=refine` 按形态自动选管线（Web 应用走读仓画图，网关/桥/通知总线/后端服务走编排）。客户界面仍只有骨架 / 精修，不暴露内部引擎名。读仓画图不可用时自动降级编排。

- **合成 edge 交付路径**：新增 `runOrchEdge` 入口与 CLI `--variant=edge`。走 auto 引擎（shape 高置信/强协议→orch4，形态歧义→orch8 降级）生成架构图，再叠加 deterministicSweep 确定性扫尾修正，最后输出 `edge-quality-report.json`（sHigh/sMed/vHigh/qualityScore/hardGatePass），把 orch4 结构闸门作为软报告内联到流程中，实现「盲评冠军 + 机评门卫」。

- **edge-gating 离线回归守卫**：`test/edge-gating.test.js` + `test/fixtures/edge-gating-fixtures.json`，基于四仓（caddy/ntfy/vaultwarden/zigbee2mqtt）基线 fixture 跑 sweep + 闸门，断言 sHigh=0、vHigh=0、sMed=0、hallu=0；`.github/workflows/ci.yml` 新增 `edge-gating` job 执行，确保闸门迭代不反噬 edge 交付。

- **auto 引擎选择规则**：`shapeDetectWithCandidates` 返回形态候选打分与置信度（high/medium/low + margin）；`runOrchAuto` 按规则路由：high 置信或 strongTop（score≥10 ∧ margin≥3）或强协议（proxy/bridge）→ orch4；其余形态歧义→ orch8；CLI 默认 variant 改为 `auto`。

- **orch8 Agent 探索路径**：通过 `explore.json` 注入 shape/trunkStory/externalSystems；externalSystems 按语义分流为「基础设施（cylinder/storage 层）」与「真外部对端（stadium/角色层）」；bridge 形态协议对端（mqtt broker/zigbee 网络）统一降级为圆柱避免冗余。

### Changed

- **deterministicSweep 新增 sMed 修复 pass**（run.js 1.4/1.5）：

  - 1.4 storage 层非 DB/中间件圆柱（代码包误画圆柱，如 caddy filestorage/stek、z2m st\_cfg）改回矩形；

  - 1.5 API 层 admin→前端 http 的「配置/部署」非推送实线翻转方向，避免逆向边方向误报。

- **pass6 特写链 id 替换**：新增 `safeShortReplace`，跳过 `<small>` 路径内容，仅在标识符位置替换，避免把 `admin.go`/`reverseproxy` 路径中的单词误改成短 id。

- **7s 结构闸门误伤修订**：

  - dup-path：目录路径（无扩展名）、同源文件多职责拆分（分层/关键词不同）豁免；

  - mech-mislabel：语义推送文件名（send/push/notify/broadcast）、节点头 WebSocket/SSE 豁免；

  - frontend-storage：静态文件服务（fileserver→filestorage）豁免；

  - server-client-sdk：服务端内部协议客户端（SDK 引用）豁免。

- **`eval/orch/usage7-sweep.js`** **与产品 run.js 扫尾同口径对齐**：扩展 INFRA\_WORDS（zookeeper/s3/minio），storage 层圆柱兜底判定为真基础设施才保留圆柱，P8 层秩逆流边翻转支持声明式边 `id["head"] -->|label| to`，确保 L1 eval 与产品侧扫尾结果一致。

- `KNOWN_VARIANTS` 追加 `edge`/`auto`，CLI variant 校验通过。

### Fixed

- **orch8 externalSystems 分流根错**：vaultwarden r1 sHigh 清零（explore 注入的基础设施不再被模板 staidum 覆盖冲突）；z2m bridge 协议对端降级圆柱，消除盲评反伤。

- **runOrchEdge** **`importance.info is not a function`**：orch4 内部重写 `state.importance` 为纯字段，入口处调用 `importanceForensics` 重建带 `info` 方法的对象，避免报告阶段 crash。

- **usage7-sweep 声明式边漏判**：`EDGE_RE` / `EDGE_RE_NOLABEL` 支持 `["head"]` 节点声明，P8 翻转不再漏特写块边。

- **deterministicSweep reloc2 幽灵节点**：先删后插导致 worker\_tracker/worker\_recorder 丢失；改为在目标子图 end 前 splice 插入；classDef 匹配兼容尾部分号；Next.js `[websiteId]/(main)` 路径括号/引号剥离，避免误报「undeclared id」。

- **漂移误报：清单文件不算架构入口**：`package.json`/`Cargo.toml` 不再生成漂移 term（showcase-shop 这类 Python 仓根目录带 package.json fixture 时误报红灯；term「package/cargo」过于泛化）；嵌套入口（`src/main.rs`）补 basename 别名，使图中 `<small>src/main.rs</small>` 路径文本能正确命中（斜杠不在 term 分隔符类内）。pro.test.js 20/20 恢复全绿。

- **精修路由 P1-P4 修复**：`championOf(imp)` 改为委托 `chooseRefinePipeline`，评测标签与实际路由同口径（web 无前端/歧义组合不再误标 agent）；agent 管线扫尾改用 `inspectShape` + `findAnchorsV2` 计算真实 anchors，与编排 edge 路径同口径；`findDsh` 去掉 npx 缓存 hash 硬编码，改为 `DSH_BIN` → `which dsh` → npx 缓存动态 glob 三级查找；agent 调用新增产物覆写校验（dsh 空跑/崩溃不再把模板当产物静默返回），降级 catch 收窄为 `AGENT_UNAVAILABLE`，其余错误上抛不吞。

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
