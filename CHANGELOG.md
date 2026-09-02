# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

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

