# Quickstart：全新项目用 Architecture Viewer

> **一句话**：装一次之后只说话；AI 改完在对话里给你看灯（verdict）。绿灯可提交，**commit 即接受**当前结构。不必先拍照、不必默认打开 HTML。  
> **适用对象**：第一次把 Architecture Viewer 用到**自己的新项目 / 陌生仓库**上的人。  
> **适用版本**：arch-viewer **0.12.0**（8 个 MCP 工具 · `av_guard` · git HEAD 基线 · 会话报告）。本文 2026-09-10。  
> **零外部分析器**：不需要安装 `lint-imports` 或 dependency-cruiser；分层与契约由 builtin 直接评估。  
> **职责**：本篇是**唯一**「通用怎么用」（安装、8 工具、日常闭环、读灯、CI）。零基础也可从 §10 迷你仓脚本跟做。舆情仓实测见 [MCP-DEMO](../demos/MCP-DEMO-publicopinionmonitor.md)。

---

## 三步速览

### ① 装一次

```bash
npm i -g arch-viewer
cd /path/to/你的新项目
arch-viewer setup                 # 用户级 MCP
arch-viewer setup . --project     # 本仓 hooks + AGENTS.md（停手自动跑结构门）
# 卸干净再升级：arch-viewer uninstall . [--npm] [--purge]
```

贴一句口令给 AI（全文见 §8，与 `arch-viewer setup` 打印的 magicPrompt 相同）：

> 改完用架构门检查一下。把 verdict 原样告诉我；绿灯可提交。

### ② 每次改功能（说话 → 看灯 → commit）

| 步骤 | 你做什么 | 工具 |
|------|----------|------|
| 说话 | 正常提需求 | — |
| 看灯 | Agent 宣称完成前调 `av_guard`；对话里最多 3 行 verdict | MCP `av_guard` / CLI `session guard` 或 `session report` |
| commit | 绿灯 → `git commit`（对照 HEAD，提交即接受） | git |

有 git 时**不必**先 `av_session_start`。无 git 时 `av_guard` 会自动补快照。HTML 详情可选。

### ③ 有红灯再深入

| 工具 | 何时用 |
|------|--------|
| `av_explain_finding` | 看不懂某条红灯 |
| `av_session_changes` | 只想秒级知道「有没有结构变化」 |
| `av_session_report` | 要完整报告 / 可选打开 HTML |
| `av_archify_export` | 要把稀疏图喂给 archify 出片 |
| `av_check_layering` | **仅第一次摸底**；日常别用 |

拍照仪式（start → 开 HTML → 再 start）见 [附录 A](#附录a-拍照仪式高级)。

---

## 术语速查

项目像一栋楼：文件是房间，import 是走廊，分层是楼层。**前台不该直达仓库**——要经过中间层；直接串门 = 红灯。有 git 时对照物是 **HEAD**；对话里那几行灯叫 **verdict**。

| 你会看到的词 | 大白话 |
|-------------|--------|
| 基线 | 对照物。有 git = HEAD（commit 即接受）；无 git = `.av/graph-baseline.json` |
| verdict | 对话里最多 3 行：灯色 + 风险计数 + 最严重 1 条 |
| 指纹 | 结构编号；变了 = 结构变了 |
| 楼层 / 分层 | 前台 / 服务 / 存储等技术层 |
| 分层覆盖率 | 多少文件已经挂上了楼层牌 |
| 串门 / 跨层 / 层级穿透 | 前台直连仓库、跳过中间层 |
| 实体 / 类型 | 类、函数、组件 |
| 扇出 | 一个文件引用了太多别的文件 |
| 红 / 橙 / 蓝 / 绿灯 | 必须看 / 建议看 / 小问题 / 没问题 |
| 波及范围 / 影响面 | 改 A 会牵动谁 |
| Before / Delta / After | 改前图 · 只画变化 · 改后图 |
| 神文件 / 文件偏大 / 行数暴涨 | 单文件太大或本轮长胖太快 |
| Archify 成片 vs 内置三栏 | 好看成片 vs 带颜色高亮的对比图 |
| MCP | 让 AI 自动调用本工具，你不用敲命令 |
| 漂移 | 代码里有**新目录 / 服务 / 入口**，六视图里漏画了（不是每个新文件） |
| 退出码 1 | 架构门未通过（报告已写出，不是工具崩溃） |

---

## 管什么 / 不管什么（期望对齐）

本工具做的是**结构验收**：依赖边、分层、入口、文件体量、图与代码是否对齐。  
函数体改动会进入「实现差异」（哪个函数、文案/调用/控制流），**仍不判定对错**。下列问题**不是** session / drift 的判定目标，请用测试、审查或专门静态分析：

| 非目标（不管） | 为什么管不到 | 建议去哪看 |
|----------------|--------------|------------|
| 逻辑错误 / 算错金额 / 条件写反 | 图谱只看 import 与类型边界，不执行代码 | 单元测试 / 代码审查 |
| N+1 查询、慢 SQL、缺索引 | 没有查询计划与 ORM 追踪 | APM / 数据库工具 |
| try/except 吞异常、空 catch | 不解析控制流语义 | linter / 审查清单 |
| 同层模块互相乱调（无环时） | 同层边默认合法；有**文件级 import 环**才会亮 | `circular-import` finding；设计评审 |
| 安全漏洞、密钥泄漏 | 不做安全扫描 | secret 扫描 / 安全工具 |
| 「这段业务该不该存在」 | 不判断产品对错 | 产品 / 架构评审 |

**管什么（会亮灯）**：跨层串门、层级穿透、类型删除、新第三方依赖、文件级循环 import（Tarjan SCC，本轮新环才报）、模块独立契约、分层配置读失败、神文件/行数暴涨、新模块未上图（漂移），本轮碰到的对外 HTTP 路由 / 数据契约文件（`public-surface-changed` / `schema-touched`），以及 `architecture-rules.yaml` 里声明的 `invariants`（`invariant-broken`）——见 §4.3、§0.5。  
**标出但不阻断**：函数体实现差异（`impl-changed`，info）——见报告「实现差异」。

一句话：**红灯 = 结构或对外契约面可能变了；实现差异 = 函数体变了；绿灯 ≠ 业务逻辑正确。**

`session start --intent "只修分层，不改 /todos"`（MCP：`av_session_start.intent`；高级）会把意图写到 `.av/session-intent.json`。若本轮仍改了声明不该动的路由/路径，会亮 `intent-mismatch`（默认 low，不阻断）；对外路由变了但测试目录指纹没变会亮 `behavior-untested`（low）。日常优先 `av_guard`，不必先 start。

团队可在 `architecture-rules.yaml` 写增量不变量，例如「本轮新增路由所在文件不得 `import` 存储层」：

```yaml
invariants:
  - id: new-route-no-direct-storage
    message: 本轮新增路由所在文件不得直接依赖存储层
    when:
      route: "*"          # 或 "GET /todos*" / "POST /alerts"
    forbid:
      to_layer: storage
      edge_type: import
  - id: todos-need-service
    when:
      route: "* /todos*"
    require:
      import_layer: service
```

---

## 0. 一次性准备（新项目）

下文用两个路径占位，请换成你的绝对路径：

```bash
export AV="$HOME/Desktop/architecture_viewer"   # 工具仓（本地开发时）
export REPO="$HOME/Desktop/你的新项目"            # 目标业务仓
```

### 0.1 安装工具

**方式 A · npm（推荐交付给别人）**

```bash
npm i -g arch-viewer
arch-viewer --version   # 应打印 package.json 版本（与 MCP initialize.serverInfo.version 同源）
arch-viewer --help
```

**方式 B · 本仓源码**

```bash
cd "$AV" && npm install
node "$AV/lib/cli.js" --help
# 下文把 arch-viewer 换成：node "$AV/lib/cli.js"
```

### 0.2 打开目标项目并一键接入 AI

```bash
cd "$REPO"
arch-viewer setup
arch-viewer setup . --project   # 推荐：写入本仓 Cursor/Claude hooks + AGENTS.md
```

`setup` 会探测本机 Cursor / Claude Code / Claude Desktop / Windsurf / DeepSeek Harness，把 MCP 写进配置。`--project` 再写停手强制层（Cursor `stop` / Claude `Stop`）和跨宿主规则。

**卸载 / 升级**（不必手改 JSON）：

```bash
cd "$REPO"
arch-viewer uninstall              # 只卸用户级 MCP / dsh（其它 MCP 保留）
arch-viewer uninstall .            # 再卸本仓 hooks、规则、项目级 mcp.json
arch-viewer uninstall . --npm      # 连全局 `npm i -g arch-viewer` 一起卸
arch-viewer uninstall . --purge    # 再删 .av 会话报告与快照（**仍保留** `.av/layers.json`）
```

默认不删业务代码、不删分层锁定、不删别人的 MCP。写入前会备份为 `.av-bak`。卸完后**完全退出并重开**编辑器；再装：`arch-viewer setup` 与 `setup . --project`。

然后：**完全退出并重启编辑器** → 打开 `$REPO` → 新开对话问：

> 列出你可用的 MCP 工具，有没有 `av_guard`？

应看到 **8 个工具**：

| 工具名 | 干什么 | 日常频率 |
|--------|--------|----------|
| `av_guard` | **优先**：ensure 基线 + 本轮 verdict | 宣称完成前 |
| `av_session_report` | 完整报告 + 同级 verdict；HTML 可选 | 要深挖时 |
| `av_session_start` | 无 git 快照 / 高级刷新 | 少用 |
| `av_session_changes` | 轻量：有没有架构变更（秒回） | 可选 |
| `av_status` | 基线 / 监听仓 / 缓存 / 是否过期 | 状态不清楚时 |
| `av_explain_finding` | 解释第 N 条红灯怎么修 | 有红灯看不懂时 |
| `av_archify_export` | 导出稀疏 Before/After JSON | 要喂 archify 出片时 |
| `av_check_layering` | 全仓历史串门清单 | **仅摸底一次** |

### 0.3（可选）生成六视图套件

若你还要「好看的分层架构图」给人看 / 给 PR 漂移用：

```bash
cd "$REPO"
arch-viewer init                 # 生成 architecture_viewer/ 套件
arch-viewer generate             # 骨架图，秒级，无需 API Key
# 可选精修（需 DEEPSEEK_API_KEY）：6 张图都会按视图精修（Block 读仓 Agent，其余 5 张专用 prompt + 源码摘录）
# arch-viewer generate --refine
```

预览（不要用 `file://` 直接开 HTML）：

```bash
cd "$REPO/architecture_viewer"
python3 -m http.server 8080
# 浏览器打开 http://127.0.0.1:8080/architecture_visualized.html?tab=block
```

默认先看 **「分层模块 / Block」** Tab（彩色大框 = 层；空层不画）。C4 更素，是建模视图，不是观感主图。

**注意**：`generate` 会**覆盖**套件里 6 个 `.md`。官方演示仓 `examples/showcase-shop` 里是手写精修稿——**不要**在原路径上 generate；先 `cp -R` 到 `/tmp` 或实验目录再练（见 §6.4）。字段与视觉通解见 [LAYERED-STYLE.md](./LAYERED-STYLE.md)。

### 0.4 建议写入 `.gitignore`

```gitignore
.av/session-report.*
.av/session-report.builtin.html
.av/session-report.archify.html
.av/session-history.jsonl
.av/graph-head.json
```

可以提交（团队共享）：`.av/layers.json`、`architecture_viewer/` 下的六视图。  
`.av/graph-baseline.json` 仅无 git / 显式 pin snapshot 时需要；有 git 时默认对照 HEAD，不必提交快照。

### 0.5（可选）分层与契约——不用装别的工具

有两套「分层」文件，别混：

| 文件 | 管什么 |
|------|--------|
| `.av/layers.json` | **会话验收**：把源码文件分到 controller / service / storage，供串门红灯用。有它就锁定；没有则用启发式。工具另写 `.av/layers.suggested.json` 当建议（可随时重生成），不要把 suggested 当锁定规则提交 |
| 仓库根 `architecture.layers.json` | **画六视图**：强制节点 / 改层 / 中文层名，让 Block 图对齐业务（见 §6.1、[LAYERED-STYLE.md](./LAYERED-STYLE.md)） |
| `architecture-rules.yaml` | 团队 `forbid_cross_layer` + `invariants`（示例见仓库根 `architecture-rules.example.yaml`） |
| `.importlinter` / `setup.cfg` `[importlinter]` / `pyproject.toml` `[tool.importlinter]` | 已有 Import Linter 契约时，**直接在依赖图上评估** forbidden / layers / independence |

会话报告**只跑内置分析器**，不 spawn 外部 CLI。不需要安装 `lint-imports` 或 dependency-cruiser。`session suggest-config` 已移除；需要草稿时手写上述文件，或沿用团队已有的 Import Linter 契约。`.av/layers.json` 损坏时会亮 `layer-config-error`（MEDIUM），不会静默降级。

---

## 1. 功能全景：本工具到底能干什么

Architecture Viewer 不是「再画一张好看的图」那么简单，而是四条能力线：

```
┌─────────────────────────────────────────────────────────────┐
│  A. 会话验收门（主路径）                                       │
│     说话 → av_guard / 对话 verdict → git commit（即接受）     │
├─────────────────────────────────────────────────────────────┤
│  B. 六视图 / 分层图                                            │
│     init + generate：给人类看的 C4 / 分层 / 部署图              │
├─────────────────────────────────────────────────────────────┤
│  C. 漂移与 PR                                                  │
│     check --drift：新模块/服务/入口图上没画；CI 评论一键修复     │
├─────────────────────────────────────────────────────────────┤
│  D. 运维信号（体量）                                           │
│     神文件 / 偏大 / 行数暴涨：Vibe Coding 防「千行大文件」      │
└─────────────────────────────────────────────────────────────┘
```

| 能力 | 解决什么痛 | 入口 |
|------|-----------|------|
| 对话 verdict | AI 改完我懒得读 diff | MCP `av_guard` / CLI `session report` |
| git HEAD 基线 | 不必先拍照；commit=接受 | 默认（无 git 才快照） |
| Before / Delta / After 图 | 用颜色定位「改了哪」 | HTML（**可选**深挖，优先 **builtin**） |
| 风险 findings | 串门、孤立实体、广泛影响、神文件 | verdict 顶条 + 报告列表 |
| 影响面 | 改一处牵动谁 | 报告「影响面」区块 |
| 六视图 | 给评审 / 新人看全景 | `init` + `generate` |
| 漂移检查 | 新模块/服务/入口没上图 | `check --drift` / PR Action |
| 文件体量 | AI 在单文件堆上千行 | findings + Delta 文件框角标 |
| Archify 导出 | 稀疏图喂外部渲染器 | `archify-export` / MCP |

**新项目建议优先级**：先打通 **A（会话验收）** → 需要对外讲架构再开 **B** → 有团队 PR 再开 **C**。D 已内嵌在 A 的报告里。

---

## 2. 第一次摸底（只做一次，可选）

老仓可能有大量历史串门；**新项目通常很少**，但摸底能帮你确认「楼层识别是否靠谱」。

**对 AI 说：**

> 对仓库 `$REPO` 调用 `av_check_layering`，用中文总结：识别了多少文件、分了几个楼层、红灯大约多少。不要逐条念，只给前 5 条样例，并说明这些是历史问题还是当前结构问题。

**怎么解读：**

| 现象 | 含义 | 你该做什么 |
|------|------|-----------|
| 楼层覆盖率高、红灯少 | 结构清晰或项目还小 | 之后用 session，别再全量扫 |
| 红灯很多 | 历史债或分层规则不准 | 调 `.av/layers.json`；日常仍用 session「只看本轮新增」 |
| 大量「未分类」 | 目录命名不符合默认启发式 | 写 `layers.json` 覆盖（见仓库 `templates/`） |

> 摸底数字**不要**当成每次验收标准。日常只看「这次改完新冒出来的红灯」。

---

## 3. 日常主路径：说话 → 看灯 → commit

### 3.1 你说话

照常提需求。结构检查放在宣称完成时，不要中途反复全量摸底。

### 3.2 宣称完成前：看灯

**对 AI：**

> 改完了。请对当前工作区调 `av_guard`（`repo` = 工作区绝对路径）。把返回的 verdict 原样告诉我。

**CLI（无 MCP）：**

```bash
arch-viewer session report "$REPO"          # 对照 git HEAD；不要默认 --open
arch-viewer session guard "$REPO" --adapter generic
```

**verdict 长什么样（最多 3 行）：**

```text
🟢 结构验收通过 · 对照 git HEAD
Risk: none · 0 findings
详情（可选）：.av/session-report.html
```

有 git 时**不必**先 `av_session_start`。无 git 时 `av_guard` 会自动写入 `.av/graph-baseline.json`（第一轮通常绿灯）。

轻量轮询（可选）：`av_session_changes` 只回答「有没有结构变化」；日常仍以 `av_guard` 为准。

### 3.3 看完灯：commit 即接受

| 灯 | 你做什么 |
|----|----------|
| 🟢 | `git commit`。提交后 HEAD 就是新对照物，不必再 `session start` |
| 🔴 / 🟠 | 先修或解释（`av_explain_finding`，`from=session`）；你接受就记一句理由再 commit |
| 详情 | 需要图时再打开 `.av/session-report.html`（可选） |

拍照仪式、强制开 HTML、无 git 手动 refresh 见 [附录 A](#附录a-拍照仪式高级)。

---

## 4. 如何解读 HTML 报告（可选深挖）

对话里的 verdict 已经够日常决策。**只有**要看 Before / Delta / After 或 findings 全文时才打开：

```text
.av/session-report.html
```

| 文件 | 是什么 | 你该不该看 |
|------|--------|------------|
| `.av/session-report.html` | **固定入口**：内置三栏或 Archify 成片（成片时页顶有链到对比图） | 可选深挖 |
| `.av/session-report.builtin.html` | 内置 Before / Delta / After 副本 | 内部产物；主入口已是成片时可通过页顶横幅进入 |
| `.av/session-report.json` | 机器可读报告（schemaVersion 2：`risk.level` + `summary.changeScale` + 完整 diff） | 调试 / 二次处理 |

`session start` 刷新基线时会清除上一轮 `session-report.*` / `archify-*`，避免打开过期红灯。

若主 HTML 是 Archify 成片，页顶可能有横幅：**「打开 Before / Delta / After」** → 点进 builtin。需要强制三栏时用 `--renderer builtin`。

### 4.1 顶栏：风险灯与汇总卡

| 灯色 | 级别 | 你怎么决策 |
|------|------|-----------|
| 🟢 无风险 / none | 0 findings | **commit 即接受**（对照 HEAD） |
| 🔵 低 / low | 偏大文件、增长较快、孤立实体等 | 知道即可，或记一笔技术债后再 commit |
| 🟠 中 / medium | 神文件、行数暴涨、广泛影响等 | 建议拆分或缩小改动面后再合 |
| 🔴 高 / high | 跨层违规、严重穿透等 | **先看清再提交**；或修掉再 `av_guard` |

汇总卡常见项：

| 卡 | 解读 |
|----|------|
| 新增 / 删除 / 修改类型 | 结构实体变了多少（不是 git 行数） |
| 新增 / 删除关系 | import / 继承等架构边 |
| 分层违规 | 本轮检出的跨层边数量 |
| 外部依赖 | +新增包 / −移除包 |
| 风险项 | findings 条数 |

### 4.2 三栏图：Before / Delta / After

```
  BEFORE              DELTA                 AFTER
  改之前的样子         只画变化（带颜色）      改之后的样子
  红顶栏               紫顶栏                 绿顶栏
```

**颜色约定（节点）：**

| 颜色 | 含义 |
|------|------|
| 绿 | 新增 |
| 黄 | 修改 |
| 红 | 删除 |
| 紫 | 移动 |
| 青 | 重命名 |
| 橙 | 违规相关（跨层等）；**Delta 栏会呼吸发光**，Before/After 为静态橙 |

**文件框角标：** `+N` / `~N` / `−N` = 框内新增/修改/删除了几个实体；有基线行数时还可能出现 `+80行 · +40%`（本轮长胖）。

**过滤按钮：**

| 按钮 | 用途 |
|------|------|
| 仅变更（默认） | 折起没改的文件，聚焦本轮 |
| 仅违规 | 只看违规边与端点；Delta 会呼吸发光强调 |
| 全部 | 整图（容易挤，大仓慎用） |

**怎么快速定位：**

1. 先看 **Delta** 中间栏（默认「仅变更」）。  
2. 有橙色发光边/节点 → 优先点开看路径。  
3. 文件框标了大行数增长 → 点开该文件考虑是否该拆。  
4. 需要语境时左右对照 Before / After。

> **本仓是纯 JS、实体级边很少时**，「仅违规」可能显示「无违规」——正常。TS / Java / Python 等类级 import 更明显。

### 4.3 风险 findings 怎么读

每条 finding 一般有：规则名、严重度、标题、说明、文件路径。

| 规则（rule） | 灯 | 大白话 | 建议动作 |
|--------------|----|--------|----------|
| `cross-layer-violation` | 🔴 | 不该跨的层连上了（含 Import Linter `layers` 契约） | 抽中间层或改依赖方向 |
| `layer-skip` | 🔴 | 如 controller 直达 storage（含 forbidden 契约） | 经 service 中转 |
| `circular-import` | 🔴/🟠 | 本轮新出现的文件级 import 环（2 文件 HIGH，3+ MEDIUM） | 抽出共享接口，或让一侧依赖抽象 |
| `independence-violation` | 🟠 | 本应独立的模块之间出现了 import | 拆掉跨模块边，或改契约 |
| `layer-config-error` | 🟠 | `.av/layers.json` 读失败，分层降级为目录推断 | 修 JSON 或重新生成分层配置 |
| `removed-type` | 🟠/🔴 | 删了一个被多处引用的类型 | 确认下游都已迁移；波及广则拆 PR |
| `new-external-dep` | 🟠 | 引入了新的第三方包 | 确认必要、体积、许可证；标准库依赖不亮灯 |
| `high-fanout` | 🔵/🟠 | 一个实体新增 5+ 条依赖 | 职责可能膨胀，考虑拆分 |
| `orphan-entity` | 🔵 | 新类型没接到架构边 | 确认是否死代码 / 漏接线 |
| `broad-impact` | 🟠/🔴 | 一处改动波及很多下游 | 拆 PR 或补测试 |
| `god-file` | 🟠 | 单文件 >800 行（本轮新达） | 拆文件 |
| `large-file` | 🔵 | 单文件 >400 行（本轮新达） | 规划拆分 |
| `file-growth` | 🔵/🟠 | 已有文件本轮暴涨 | 别在上帝文件上继续堆 |

**重要口径（和「串门」一样）：**

- 只报**本轮新出现**的问题，不把全仓历史债一次甩脸。  
- 旧基线没有行数数据时，已有文件的 large/god **先不报**；你确认报告无误后 `session start` 刷新基线，**之后**再涨才会亮。

### 4.4 影响面怎么读

| 字段 | 意思 |
|------|------|
| 被改实体 | 这次动到的类型/文件 |
| 直接下游 | 直接依赖它的模块 |
| 间接下游 | 再下一跳 |

改动「底层工具 / 公共模型」却波及十几个下游 → 即使没有跨层红灯，也要提高评审权重。

### 4.5 关系变更 / 实体变更列表

- **实体**：新增函数/类、删除、重命名、跨目录移动。  
- **关系**：新增 import、删除边、重连（类型变了）。顶栏「新增/删除关系」与 Delta 图同一口径：**只计高信号架构边**（import / extends / implements / 类型边）。归属边（declared-in）仍在原始 `summary.addedEdges` 里，默认不进图、不进顶栏；CLI `--all` 才展开。

---

## 5. 文件体量监控（Vibe Coding 专用）

AI 常在一个文件里堆上千行，后期难维护。本工具把体量放进**同一份 session 报告**，不另起仪表盘。

| 信号 | 阈值（约） | 你在报告里看到 |
|------|------------|----------------|
| 文件偏大 | >400 行 | 🔵 large-file |
| 神文件 | >800 行 | 🟠 god-file |
| 增长较快 | +≥150 行或 +≥40% | 🔵 file-growth |
| 行数暴涨 | +≥300 行或 +≥100% | 🟠 file-growth |
| Delta 文件框 | 有基线行数且本轮变长 | 橙/红描边 + 行数角标 |

**AGENT.md / Cursor 规则**只能「劝」AI 拆文件；**报告 findings** 才能在你懒得读代码时仍看见「这个框突然变厚了」。两者可并用，以产品检查为准。

---

## 6. 六视图与漂移（新项目可选）

### 6.1 六视图是什么

| 文件 | 视图 |
|------|------|
| `c4-context.md` | 系统全景 |
| `c4-container.md` | 容器 / 服务 |
| `c4-component.md` | 组件 |
| `block-diagram.md` | **分层模块（观感主视图）** |
| `class-diagram.md` | 类图 |
| `deployment-ops.md` | 部署运维 |

生成后优先看 Block。详细规范见套件内 `AGENT.md`；视觉层名与 `architecture.layers.json` 字段见 [LAYERED-STYLE.md](./LAYERED-STYLE.md)。

**规则扫描不够准时**：在仓库根放 `architecture.layers.json`（示例：`templates/architecture.layers.example.json`），再 `generate` 一次。常用字段：`order` / `titles`（层顺序与中文名）、`nodes`（强制节点）、`aliases`（把扫描节点改层）、`edges`（自定义箭头）。通解用法是：**规则扫描打底 → layers.json 对齐真实业务层**，不必为每个仓改工具源码。

节点太多 / 杂文件挤进前端时：用 `nodes` **白名单**只保留 6～10 个关键块，不要让 `extra/` 一类目录全画上。

### 6.2 漂移检查

```bash
arch-viewer check architecture_viewer --filled --drift --repo "$REPO"
```

| 结果 | 含义 |
|------|------|
| 绿 | 扫描到的目录 / 服务 / 入口名，能在六视图里找到 |
| 漂移 | 扫描到的目录 / 服务 / 入口，图上没画（或 `--filled` 规范未填满） |

**粒度（按设计，不是漏检）**：`--drift` 对的是 **模块目录、compose/部署服务、入口文件**，不是每一个 `.py` / `.js`。

| 改动 | `check --drift` | 该看哪 |
|------|-----------------|--------|
| 已有包里加一个文件（如 `app/routes/new.py`） | 绿（目录名早已在图上） | **会话报告** / 项目结构 / 文件体量 |
| 新建顶层目录或新服务（如 `billing/`、`openim-rpc`） | 红：该名字没出现在任何一张图 | 补六视图，或 `--update` 增量同步 |
| 新增入口（如 `src/main.rs`、`cmd/foo`） | 图里没写到这个入口就红 | 补 C4 / Block 节点 |

一句话：**CI 漂移门禁的是「新模块没上图」，不是「每个新文件都必须出现在图上」。** 文件级变化走 §3 会话报告。

接入 PR（一次）：

```bash
mkdir -p .github/workflows
curl -fsSL https://gitee.com/heyangyan/architecture_viewer/raw/master/templates/architecture-check.yml \
  -o .github/workflows/architecture-check.yml
```

需要 PR 评论（而不只是红灯）时，用仓里的 `scripts/ci-drift-action.mjs`。评论会带**补哪张图 + 源码行号 + 一键修复 Prompt**。compose 服务名必须出现在六视图某张图的文本里；`architecture.layers.json` 的 `nodes.id` / `sub` 写上服务名即可消漂移。

### 6.3 强制门禁：pre-commit（可选）

会话报告 HIGH 时退出码已是 1，但默认不挡 `git commit`。把钩子拷进业务仓即可卡门禁：

```bash
# 在你的业务仓根目录
curl -fsSL https://gitee.com/heyangyan/architecture_viewer/raw/master/templates/pre-commit \
  -o .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

本仓开发时可：`cp templates/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`。

| 情况 | 行为 |
|------|------|
| 无 git 且无 `.av/graph-baseline.json` | 跳过或先 `av_guard` / `session start` |
| 有 git HEAD（或快照）且无 HIGH | 放行 |
| 有 HIGH 红灯 | **拒绝提交**；看对话 verdict 或 `.av/session-report.html` |

#### 风险等级与退出码

`session report` / `workspace report` 默认只把 **HIGH** 当成门禁失败。报告总会写出来；退出码 1 表示架构门未通过，不是工具崩溃。

权威风险（findings 最高严重度）按输出面读这些字段——它们必须同值：

| 输出面 | 权威风险 | 变更规模（不是风险） |
|--------|----------|----------------------|
| HTML 内嵌 `REPORT_DATA` | `risk.level` | `summary.changeScale` |
| `.av/session-report.json` | `risk.level`（`riskSummary.level` 为同值别名） | `summary.changeScale` / `diff.summary.changeScale` |
| MCP `av_session_report` | 顶层 `riskLevel`，以及 `summary.riskLevel`（同值便捷副本） | `summary.changeScale` |

`diff.summary.riskLevel` 在 schemaVersion 2 中已删除。**不要**把 `changeScale` 当成风险去卡门禁。

schemaVersion **2** 起：`summary.changeScale` 取代 `diff.summary.riskLevel`；落盘 JSON 与 HTML 都带 `risk.level`。旧消费者：`diff.summary.riskLevel` → `risk.level`（风险）或 `summary.changeScale`（规模）。

| 风险 | 默认退出码 | CI 建议 |
|------|-----------|---------|
| high | 1 | 阻断合并 |
| medium | 0 | 审阅；需要更严时 `--fail-on medium` |
| low | 0 | 提示，不阻断 |
| none | 0 | 通过 |

```bash
arch-viewer session report --fail-on high     # 默认：仅 HIGH → 1
arch-viewer session report --fail-on medium   # MEDIUM 及以上 → 1
arch-viewer session report --fail-on low      # 任何 finding → 1
arch-viewer session report --fail-on none     # 只出报告，永远 0
```

`session report` / `check` / `diff` 共用退出码（CI 只看数字，不必解析输出）：

| 码 | 含义 | 典型触发 |
|----|------|----------|
| 0 | 通过 | 无门禁风险；`check` 套件/漂移/规则通过 |
| 1 | 架构门未通过 | HIGH（或达到 `--fail-on`）；`check` 协议/漂移/规则违规。报告已写出，**不是崩溃** |
| 2 | 参数或配置错 | 缺参数、未知命令、`--fail-on` 非法、`--rules` 缺失或无法解析 |
| 3 | 扫描或解析失败 | 构图/写报告抛错；路径存在但不是可扫描目录 |
| 4 | 基线不存在或失效 | `session` 无/坏 `.av/graph-baseline.json`；`check` 无套件图或 `--repo` 不存在；`diff` 路径不存在或图 JSON 损坏 |

`diff` 也支持 `--fail-on`，语义与 `session report` 相同。

| 紧急绕过 | `git commit --no-verify`（请在 PR 说明） |

PR 漂移门仍用 CI 模板（§6.2），与本地 pre-commit 互补。

### 6.4 练手：演示仓与开源仓（可选）

会话门（§3）不依赖六视图；下面只在你要练 **init → generate → 看 Block → layers 覆盖** 时用。实验仓请放在工具仓外，例如：

```bash
export LAB="$HOME/Desktop/arch-viewer-labs"
mkdir -p "$LAB"
# 本仓路径（npm 全局安装时可省略，直接用 arch-viewer）
export AV="$HOME/Desktop/architecture_viewer"
```

**A · Coffee Shop（本仓库自带，约 5 分钟）**  
目录名就是 frontend / backend / worker，规则生成最接近「一眼分层」。**不要**在 `examples/showcase-shop` 原路径 generate（会盖掉手写精修稿）：

```bash
rm -rf "$LAB/showcase-shop"
cp -R "$AV/examples/showcase-shop" "$LAB/showcase-shop"
arch-viewer init "$LAB/showcase-shop"
arch-viewer generate "$LAB/showcase-shop"
arch-viewer check "$LAB/showcase-shop/architecture_viewer" \
  --filled --drift --repo "$LAB/showcase-shop"
cd "$LAB/showcase-shop/architecture_viewer" && python3 -m http.server 8081
# http://127.0.0.1:8081/architecture_visualized.html?tab=block
```

应能看到前端 / API / Worker / 存储(redis·mq) / 运维(deploy) 等有节点的层。业务叙事（顾客、支付网关）要靠 Cursor 或 `architecture.layers.json` 补。

**B–D · 真实开源仓（扫描边界 + layers 样例）**  
本仓已备覆盖文件：`docs/labs/oss-labs/*.layers.json`。

| 仓 | 克隆后 | 覆盖后再 generate | 说明 |
|----|--------|-------------------|------|
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | `init` + `generate` | `cp "$AV/docs/labs/oss-labs/uptime-kuma.layers.json" "$LAB/uptime-kuma/architecture.layers.json"` | 杂文件易挤进前端；覆盖后偏看板 → API → SQLite → 心跳/告警 |
| [listmonk](https://github.com/knadh/listmonk) | 同上 | `…/listmonk.layers.json` | frontend / Go / Postgres 较清晰；预览标题怪时改套件 `architecture.config.js` 的 `project.title` |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | 同上 | `…/changedetection.layers.json` | Worker/API 能扫到，展示/通知层名常要补；最像「采集系统」附件 |

通用四步：`git clone --depth 1` → `arch-viewer init <路径>` → `generate` →（可选）拷 layers.json 再 `generate` → `http.server` 看 `?tab=block` → `check --filled --drift --repo <路径>`。

目录命名乱、想要中文业务名时：`arch-viewer generate <路径> --refine`（需 `DEEPSEEK_API_KEY`），或 Cursor + 套件 `AGENT.md`。精修后也要再 `check`。

**边界**

- `generate` 覆盖六视图是预期行为；精修请用 git。  
- 实验仓在 `$LAB`，**不要**把生成的 `architecture_viewer/` 提 PR 回别人上游；自己的产品仓才适合提交套件。  
- 自己业务仓同一套路：`init` → `generate` → 按需写 `architecture.layers.json` → 再 `generate`。

---

## 7. CLI 对照表（心里有数）

| 做什么 | 让 AI（MCP） | 自己敲 |
|--------|--------------|--------|
| **日常结构门** | `av_guard` | `arch-viewer session report` / `session guard` |
| 轻量有无变更 | `av_session_changes` | （看报告 / diff） |
| 完整报告 / HTML | `av_session_report` | `arch-viewer session report --open`（可选） |
| 会话状态 | `av_status` | （看 `.av/` 与命令回显） |
| 强制三栏高亮 | — | `session report --renderer builtin --open` |
| 解释红灯 | `av_explain_finding` | 看 HTML findings |
| 无 git 快照 / 高级 | `av_session_start` | `arch-viewer session start` |
| 全楼摸底 | `av_check_layering` | 日常不用 |
| 导出稀疏图 | `av_archify_export` | `arch-viewer archify-export` |
| 生成分层图 | — | `init` → `generate` |
| 卸载接入 | — | `arch-viewer uninstall [repo] [--npm] [--purge]` |
| 漂移（目录/服务/入口） | — | `check --filled --drift --repo .` |
| 影响面 | （含在 report） | `arch-viewer impact <base> <head> --open` |

引擎相同；MCP 只是让 AI 替你按节奏调用。

---

## 8. 复制给 AI 的固定口令（贴进 AGENTS.md / 用户规则）

**不要在规则里写死绝对路径。** 每次调用都必须显式传当前工作区根的绝对路径 `repo`；worktree / 多窗口沿用主仓路径会指错仓。

下文与 `lib/setup.js` 的 `magicPrompt()` / `arch-viewer setup` 打印内容一致：

```text
【架构检查规则 · Architecture Viewer】
用当前工作区根作为项目路径，不要沿用历史对话里的绝对路径（worktree / 多窗口会指错仓）。
日常只做一件事：改完代码、宣称完成前，调用 MCP 工具 av_guard（repo=当前工作区绝对路径）。
有 git 时会自动对照 HEAD，一般不必先 av_session_start；无 git 时 av_guard 会自动补快照。
把返回的 verdict（最多 3 行）原样告诉我：绿灯可继续/可提交（commit 即接受当前结构）；红灯先修或解释，可用 av_explain_finding。
不要默认打开 HTML；详情链接可选。不要用 av_check_layering 做日常验收。
av_session_start / av_session_report 仍可用（脚本/高级），但日常优先 av_guard。
```

之后你可以说：「改完用架构门检查一下」，AI 应调用 `av_guard` 并把灯贴回对话。

---

## 9. 绿灯 / 红灯之后你做什么

| 情况 | 你做什么 |
|------|----------|
| 🟢 绿灯 | **commit 即接受**；下一轮继续对照新 HEAD |
| 🔴/🟠 不合理 | 让 AI 按建议改 → 再 `av_guard` |
| 🔴/🟠 你接受 | 记一句理由 → `git commit`（等于认领现状） |
| 只改了注释 | 报告写「检测到源码内容变化，未检测到架构结构变化」——注释不进结构指纹，也不进实现差异 |
| 只改了函数体 / 日志字符串 | 结构仍是 0 变化；「实现差异」列出改了哪个函数（文案/常量、调用、控制流）。**不判定对错**，请配合测试与审查 |
| 报告说 NO_BASELINE | 有 git 直接 `av_guard`；无 git 也会自动 ensure。仍失败再 `session start` |

有 git 时**不要**用 `session start` 把未提交的红灯洗成基线——那会绕过「commit=接受」。无 git 仓刷快照等于认领现状，请先看灯。

---

## 10. 五分钟最小路径（抄这个）

1. `npm i -g arch-viewer` → `cd $REPO` → `arch-viewer setup` →（推荐）`arch-viewer setup . --project` → 重启编辑器  
2. 打开 `$REPO` 后对话：「实现一个小改动……改完调 `av_guard`，`repo` 用当前工作区绝对路径」  
3. 看对话里的 **verdict**：绿灯 → `git commit`；红灯 →「`av_explain_finding` 第 0 条并给补丁」再 `av_guard`  
4. （可选）打开 `.av/session-report.html` 看 Delta  

想先看见红灯再动真仓，用下面两条之一（日常仍走 §3）：

1. **本仓迷你订单系统（推荐）**：`examples/beginner-demo/` —— 图文跟做见 [beginner-guide](./beginner-guide/index.html)；命令：`npm run demo:beginner:step` 或 `npm run demo:beginner`。预期 HTML 有 `PaymentService` 新增、HIGH 层级穿透，退出码常为 1。不要对整个 `architecture_viewer` 仓练 session。说明见 [examples/beginner-demo/README.md](../../examples/beginner-demo/README.md)。  
2. **自己的仓副本**：rsync 到 `/tmp/xxx-demo`，故意加一行跨层 import 再 session。舆情仓脚本见 [MCP-DEMO §3](../demos/MCP-DEMO-publicopinionmonitor.md#3-隔离练习故意串门看红灯不碰真仓)。

---

## 11. 常见卡点

1. **Cursor 看不到 MCP** → 路径是否绝对路径、是否重启、MCP 面板是否报错。  
2. **NO_BASELINE** → 调 `av_guard`（会自动 ensure）；无 git 且仍失败再 `av_session_start`。  
3. **一检查上百条红灯** → 误用了 `av_check_layering`；改回 `av_session_report`。  
4. **主 HTML 好看但看不出变化** → 打开 **builtin** 三栏，或 `--renderer builtin`。  
5. **改了代码结构图却无变更** → 只动了函数体/文案。图仍是 0 结构变化；看「实现差异」和 `impl-changed`（info），不是「源码没变」。注释-only 仍只报源码内容变化。  
6. **Delta 文字挤在一起** → 更新到含排版修复的版本并硬刷新浏览器（Cmd+Shift+R）。  
7. **仅违规是空的** → 本轮无跨层边，或语言提取不到类级边；先看 findings 文字列表。  
8. **体量规则从不亮** → 基线还是旧的（无 `lineCount`）；确认一轮报告后刷新基线即可。  
9. **想强制红灯不许提交** → 安装 pre-commit 钩子（见 §6.3）；仅 HIGH 挡提交，与 CLI 退出码一致。  
10. **团队禁令（如 domain→infra）不亮** → 在仓库根放 `architecture-rules.yaml`（参考根目录示例），`forbid_cross_layer` 会进 session report；`naming`/`rel_whitelist` 仍只审 C4 文档（`check --rules`）。  
11. **加了文件但 `check --drift` 仍绿** → 正常。漂移看的是目录/服务/入口名，不是每个文件；文件级看会话报告（§3、§6.2）。  
12. **要不要装 lint-imports / dependency-cruiser** → 不用。builtin 直接读 `.importlinter` / `architecture-rules.yaml` / `.av/layers.json`（§0.5）。  
13. **分层一直像目录猜的、还有 `layer-config-error`** → `.av/layers.json` JSON 坏了；修好或删掉后重新生成，再 `session report`。  
14. **`generate` 把我精修的六视图盖掉了** → 预期行为。精修请用 git；showcase 只 check、不要在原路径 generate（§0.3、§6.4）。  
15. **开源仓图挤 / 层不对** → 拷 `docs/labs/oss-labs/*.layers.json` 为仓库根 `architecture.layers.json` 再 generate（§6.4）；字段见 LAYERED-STYLE。  
16. **红灯一定是错吗** → 不一定。表示「值得亲眼看一眼」；你接受就 **commit**（§9）。  
17. **电脑还没装 Node** → 先装 [Node LTS](https://nodejs.org/)（≥18），终端里 `node -v` 有版本号后再 `npm i -g arch-viewer`。  
18. **换电脑 / 升级版本怎么卸干净** → `arch-viewer uninstall .`；连全局包加 `--npm`；要清会话报告加 `--purge`（保留 layers.json）。不要手改别人的 MCP。卸完重启编辑器再 `setup`。

---
## 12. 相关文档

| 文档 | 内容 |
|------|------|
| [MCP-DEMO-publicopinionmonitor.md](../demos/MCP-DEMO-publicopinionmonitor.md) | 舆情仓**实战附录**（实测数字 + `/tmp` 串门 + 该仓口令） |
| [MCP-DEMO-publicopinionmonitor-short.md](../demos/MCP-DEMO-publicopinionmonitor-short.md) | 同上 1 页速查 |
| [beginner-guide/index.html](./beginner-guide/index.html) | 小白图文攻略（装 Node + 迷你仓红灯） |
| [dependency-removal-summary/dependency-removal-summary.html](../plans/dependency-removal-summary/dependency-removal-summary.html) | 外部 CLI 拆除后的架构变更摘要 |
| [LAYERED-STYLE.md](./LAYERED-STYLE.md) | 分层图视觉通解与 `architecture.layers.json` 字段 |
| [npm-publish.md](../commercial/npm-publish.md) | 发布 / 版本说明 |

---

## 13. 纯 CLI 速查（不用 MCP）

不想接 AI 编辑器、只想自己敲命令？引擎与 MCP 相同。日常对照 **git HEAD**，不必先 `session start`。

### 13.1 安装

```bash
npm i -g arch-viewer
cd $REPO
arch-viewer session report          # 对照 HEAD；加 --open 才打开图
# 卸接入：arch-viewer uninstall .
```

### 13.2 日常循环

```bash
# 改码……（编辑器随意）
arch-viewer session report          # 看终端 verdict；绿灯再 git commit
# 可选深挖：
arch-viewer session report --renderer builtin --open
```

报告打开后看什么：
- **Delta 栏**：绿增 / 黄改 / 红删 / 紫移 / 青重命名；橙边 = 违规（呼吸发光）。
- **findings 表**：🔴 高 / 🟠 中 / 🔵 低，逐条给建议动作。
- **影响面**：波及了哪些下游模块。

### 13.3 CLI 与 MCP 对照

| 做什么 | CLI | MCP（AI 代劳） |
|--------|-----|----------------|
| **日常结构门** | `session report` / `session guard` | `av_guard` |
| 完整报告 | `session report --open`（可选） | `av_session_report` |
| 解释红灯 | 看 HTML findings 表 | `av_explain_finding` |
| 无 git 快照 | `session start` | `av_session_start` / `av_guard` 自动 ensure |
| 导出稀疏图 | `archify-export` | `av_archify_export` |
| 漂移检查（目录/服务/入口） | `check --filled --drift --repo .` | — |
| 影响面 | `impact <base> <head> --open` | 含在 report |
| 卸载接入 | `uninstall [repo] [--npm] [--purge]` | — |

### 13.4 什么时候考虑接 MCP

- 改动频繁、想停手自动验收 → `setup --project` + MCP，让 AI 调 `av_guard`。
- 偶尔用 / 团队 CI 用 → 纯 CLI 够了。
- 多人协作需要 PR 评论 → 接 GitHub Actions + `check --drift`。

---

## 附录 A · 拍照仪式（高级）

<a id="附录a-拍照仪式高级"></a>

日常路径是 **说话 → `av_guard` → commit**。下面仅用于：无 git、要 pin 快照（`AV_BASELINE=snapshot`）、或脚本必须显式 refresh。

**改之前拍快照：**

```bash
arch-viewer session start "$REPO"
```

MCP：`av_session_start`（显式传当前工作区绝对路径 `repo`）。返回里核对 `path.checking`。

| 模式 | 自动监听？ | 改完怎么验收 |
|------|-----------|--------------|
| **MCP**（Cursor 等长期进程） | 会：默认约 **8 秒**防抖后预生成报告 | 直接 `av_guard` / `av_session_report`（取消防抖） |
| **CLI** `session start` | **不会**持续监听 | 改完 `session report`（不要默认 `--open`） |

无 git 时确认报告无误后再 `session start` 等于认领快照。有 git 时请用 **commit** 接受，不要靠二次 start 洗基线。

强制三栏图：

```bash
arch-viewer session report "$REPO" --renderer builtin --open
```

---

**记住一条线：**  
说话 → `av_guard`（对话 verdict）→ 绿灯 `git commit`。  
HTML、`session start`、六视图都是这条线上的放大镜或团队插件。
