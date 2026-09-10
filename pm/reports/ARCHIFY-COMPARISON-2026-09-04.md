# Archify 对比评估 · 2026-09-04

> 对象：`tt-a1i/archify`（v2.17.0-dev.1，214 commits，MIT License）
> 对比基准：本项目 Architecture Viewer（v0.10.0）
> 结论先行：**不是竞品，是上下游互补关系。**

## 一、核心定位对比

| 维度 | Archify | Architecture Viewer |
|---|---|---|
| 本质 | **图示渲染器**（JSON → 精美 HTML/SVG） | **代码分析器**（源码 → 架构图） |
| 输入 | 手编或 Agent 生成的 JSON IR | 真实源代码文件 |
| 输出 | 5 种图：架构图 / 工作流 / 时序图 / 数据流 / 生命周期 | 分层架构图 + 风险 findings + 影响面分析 |
| 代码理解 | 零——不解析任何语言 | 4 种语言：JS/TS、Python、Go、Java |
| 分发形态 | Agent Skill（`npx skills add`），无 VS Code 插件 | VS Code 插件 + Web + MCP Server + CLI |
| 典型用户 | 在 Chat 里让 Agent 画系统图的人 / 写文档配图的人 | 需要监控代码架构质量的开发团队 / AI 编码会话验收 |
| 验证方式 | JSON Schema 校验 + golden test | 真实代码解析 + 风险规则引擎 + 跨层检测 |

一句话：**Archify 解决"画得好不好看"，你解决"画得对不对、从哪来"。**

## 二、能力逐项对比

### 2.1 图示渲染能力

Archify 在渲染层面碾压，这是它的全部投入方向：

- **5 种图类型**：架构、工作流、时序、数据流、生命周期——每种都有独立的渲染器和 schema。
- **视觉系统**：4 套预设（Signal Flow / Blueprint / Classic 等）、深浅主题、品牌商标库（simple-icons 集成）、有限动画（motion governor 控制）、分享卡片（1200×630 PNG）。
- **交互**：搜索节点、上下游追溯（authored reach）、路由探测（route probe）、语义透镜（semantic lens）、引导式故事播放（guided story / chapters）。
- **架构 Delta**：Before / Delta / After 三视图对比，精确识别 added / removed / changed / moved / rerouted，带机器校验收据。
- **质量门禁**：80+ 测试文件、golden test 对比、XML 结构校验、渲染输出契约（delivery contract）。

你的项目在渲染上的投入：

- 1 种图（分层架构图），本次会话刚加了文件容器布局。
- Before / After 双面板，基于 diff-graph 的实体级对比。
- 交互限于 hover 高亮、过滤器切换。

**差距**：渲染质量和交互丰富度上，Archify 领先 1-2 个大版本。这是预期内的——它是一个专职渲染器，所有代码都花在这件事上。

### 2.2 代码分析能力

Archify **完全没有**代码分析能力。它的"从仓库生成架构图"案例（mco-org/mco）是 Agent 先读代码、再手动组装 JSON IR，Archify 只负责最后一步渲染。证据：

- 源码里没有任何 parser / AST / 语言分析模块。
- 输入是严格定义的 JSON Schema，不是源码路径。
- README 明确写："No repository is required: describe the system in any agent chat."

你的项目在代码分析上的核心能力：

- 4 种语言解析（JS/TS 走 ts-morph，Python 走 ast，Go 走纯解析，Java 走语法树）。
- 分层检测（component / controller / service / domain / storage / dto / config / util）。
- 依赖边提取（import / extends / implements / field-type / method-param / method-return）。
- 风险规则引擎（跨层违规、层级穿透、神文件/文件增长、外部依赖激增、孤立实体、影响面等）。
  - **不是**现成能力：代码图「循环依赖」检测尚未实现（勿写成已有）；文档侧 `architecture-rules.yaml` 只管 C4 Rel，不审代码 import。
- 影响面计算（ripple effect）。

**差距**：代码分析是你的独家壁垒，Archify 完全不碰这块。

### 2.3 分发与生态

| 维度 | Archify | Architecture Viewer |
|---|---|---|
| 分发方式 | Agent Skill（skills 协议），支持 Cursor / Claude Code / Codex / OpenCode / Raven / DSH | VS Code 插件 + npm CLI + MCP + Web 离线包 |
| 安装体验 | `npx skills add tt-a1i/archify -g` 一行，多 Agent 自动适配 | `arch-viewer setup` 一键写入 5 种 AI 工具配置（刚做完，待验证） |
| 社区热度 | Trendshift 上榜、有 Sponsor、214 commits、50 issues、57 PRs | 刚起步 |
| 文档质量 | 完整的 guide / start / gallery / proof lab，多语言 | README + 若干 docs，MVP 阶段 |
| 测试体量 | 80+ 测试文件，golden + 渲染契约 + 浏览器端 | 234 用例（含大量数据驱动用例），单元为主 |

## 三、关键洞察

### 洞察 1：不是竞争，是上下游

Archify 的输入恰好是你项目可以输出的东西。你从代码里提取出架构图的数据结构（节点 + 边 + 层级 + 风险），理论上可以转换成 Archify 的 JSON IR 格式，然后用它的渲染器产出精美图示。

但注意一个**关键错位**：Archify 的架构图是「运行时部署视角」（component / backend / database / cloud / external / security / messagebus），而你的图是「代码分层视角」（controller / service / domain / storage / dto / config / util）。两者的分类体系不同，不是直接 1:1 映射。

### 洞察 2：Archify 的 Architecture Delta 思路可以借鉴

Archify 的 delta 模块做了几件你现在没做、但方向一致的事：

- **规范化 canonical 表示**：把图结构转成规范字符串用于比较，避免顺序差异等噪音。你现在的 diff-graph 是按 id 比对的，方向一致但粒度更粗。
- **精确的变更分类**：added / removed / changed / moved / rerouted 五种。你目前只有 added / removed / modified / renamed 四种，缺少 moved（节点位置/归属变化）和 rerouted（边的路径重连）。
- **Delta 中间视图**：不是只有 Before/After，还有一张 Delta 图专门展示变化。

这些都是你可以在 `diff-graph.js` 和 `session-report.js` 中借鉴的方向。

### 洞察 3：Archify 的质量工程值得学习

- **Golden test 体系**：每个渲染器都有对应的 golden 文件，渲染输出逐字节比对，防止视觉回归。
- **Delivery contract**：明确规定输出文件必须包含什么（schema 版本、校验收据、可访问性要求），fail-closed。
- **Schema-first**：所有输入都有 JSON Schema，AJV 校验，非法输入直接报错。你的项目目前是"尽量解析、解析不出来就跳过"的容错模式——两种策略各有道理，但在 MCP 工具层面可以引入更严格的输入校验。

### 洞察 4：Archify 的商业模式

- MIT 开源 + Skill 分发 + Sponsor 模式（APINEBULA、EverMind）。
- 免费使用，靠云服务和基础设施赞助变现。
- 你的 Pro/Team 模式（账号体系 + 私有云 + 团队协作）跟它完全不在一个赛道，没有商业冲突。

## 四、建议

### 建议 1：不要慌，继续走自己的路

Archify 做的是"把图画漂亮"，你做的是"从代码里把图找出来并判断对不对"——这两件事难度和价值不在一个维度。代码分析的护城河（多语言解析、分层规则、风险检测、影响面计算）Archify 完全没有，也不打算做（从它的路线图看，专注在渲染和交互上）。

### 建议 2：在渲染层，考虑"用 Archify 替代自研"或"向 Archify 学习"两种策略

**短期（1-2 个月）**：先向 Archify 学习，不用急着集成。具体可借鉴的点：

1. **delta 模块的变更分类法**——把 moved 和 rerouted 加进 `diff-graph.js`，报告里的变更描述可以更精确。
2. **golden test 模式**——`session-report.js` 的渲染输出目前没有视觉回归测试，引入 snapshot 测试（对比生成的 SVG 结构）防止改动破坏布局。
3. **Schema-first 的 MCP 输入校验**——给 MCP 工具的输入加上 AJV 校验，fail-closed 而不是容错。

**中期（3-6 个月）**：评估是否把渲染层替换为 Archify。前提是：

1. 你的分层架构数据能映射到 Archify 的组件类型体系（可能需要扩展 Archify 的 schema，或者用自定义 type）。
2. Archify 的交互模型（search / reach / lens / story）对你的使用场景有实际价值，而不只是好看。
3. 集成成本低于自研渲染器的维护成本。

如果评估通过，架构会变成：
```
你的项目（分析层） → JSON IR → Archify（渲染层） → 精美 HTML
```
你专注在代码分析和风险检测这个核心壁垒上，渲染交给更专业的工具。

### 建议 3：可以考虑成为 Archify 的"数据源"或"分析插件"

Archify 目前从代码生成图完全靠 Agent 手动描述，这是它的一个短板——生成的图是否准确完全取决于 Agent 的理解能力。你的项目可以成为 Archify 的"事实来源"：

- 一个 `archify-trace` 工具：输入代码仓库，输出 Archify 格式的 JSON IR。
- 或者反过来：你的 MCP 增加一个 `av_export_archify` 工具，把当前分析结果导出成 Archify 可渲染的格式。

这样 Archify 的用户获得了"真实代码验证"的能力，你的项目获得了 Archify 社区的曝光，双赢。

### 建议 4：差异化定位要更清晰

在对外表达上，明确区分：

- **Archify** = "Agent 画图工具" / "图示即代码"
- **Architecture Viewer** = "AI 编码架构验收门" / "代码架构质量监控"

不要把自己定位成"另一个架构图工具"，而是"代码架构质量保证工具"，图只是呈现方式之一。核心价值是：**检测违规、评估风险、计算影响面、拦住坏变更**——这些是 Archify 完全不碰的。

### 建议 5：快速行动项（本周可做）

1. 把 Archify 的 `architecture-delta.mjs` 精读一遍，提取 moved / rerouted 的判定逻辑，加到你的 `diff-graph.js`（约 2-3 小时）。
2. 给 `session-report.js` 加 2-3 个 golden test 用例，防止后续渲染改动出现视觉回归（约 1-2 小时）。
3. 在 W02 规划里加一个"竞品渲染层调研"任务，专门评估 Archify 集成的可行性和成本（约 4 小时，可放在 W03）。
