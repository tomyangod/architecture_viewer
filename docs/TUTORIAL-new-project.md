# 全新项目上手教程：用 Architecture Viewer 看清 AI 改了什么

> **一句话**：把本工具接到任意新仓库后，AI 改代码前自动「拍照片」，改完自动对比结构——你用图和红绿灯验收，不必逐行读 AI 写的代码。  
> **适用对象**：第一次把 Architecture Viewer 用到**自己的新项目 / 陌生仓库**上的人。  
> **适用版本**：arch-viewer **0.11.x**（6 个 MCP 工具 · 会话报告 · 文件体量 · PR 漂移）。本文 2026-09-06。  
> **风格参考**：[MCP-DEMO-publicopinionmonitor.md](./MCP-DEMO-publicopinionmonitor.md)（舆情仓实战）；本篇改成「任意新项目」通用版，并补齐报告解读与体量监控。

---

## 三步速览

### ① 装一次

```bash
npm i -g arch-viewer          # 或 clone 本仓用 node lib/cli.js
cd /path/to/你的新项目
arch-viewer setup             # 自动配 Cursor / Claude 等
```

贴一句口令给 AI（见 §8）：

> 以后改我的代码之前先拍照片；改完检查有没有改坏。有问题用大白话告诉我。

### ② 每次改功能

| 步骤 | MCP 工具 / CLI | 说明 |
|------|----------------|------|
| 📷 拍照 | `av_session_start` / `session start` | 记下「改之前」结构 |
| 🔨 AI 改代码 | （你说话） | 正常提需求 |
| 📋 对比 | `av_session_report` / `session report --open` | Before / Delta / After + 红绿灯 |

### ③ 有红灯再深入

| 工具 | 何时用 |
|------|--------|
| `av_explain_finding` | 看不懂某条红灯 |
| `av_session_changes` | 只想秒级知道「有没有结构变化」 |
| `av_archify_export` | 要把稀疏图喂给 archify 出片 |
| `av_check_layering` | **仅第一次摸底**；日常别用 |

---

## 术语速查

| 你会看到的词 | 大白话 |
|-------------|--------|
| 拍照片 / 基线 | 记录「改之前」的结构，存在项目 `.av/graph-baseline.json` |
| 指纹 | 结构编号；变了 = 结构变了 |
| 楼层 / 分层 | 前台 / 服务 / 存储等技术层 |
| 串门 / 跨层 / 层级穿透 | 前台直连仓库、跳过中间层 |
| 红 / 橙 / 蓝 / 绿灯 | 必须看 / 建议看 / 小问题 / 没问题 |
| 波及范围 / 影响面 | 改 A 会牵动谁 |
| Before / Delta / After | 改前图 · 只画变化 · 改后图 |
| 神文件 / 文件偏大 / 行数暴涨 | 单文件太大或本轮长胖太快 |
| Archify 成片 vs 内置三栏 | 好看成片 vs 带颜色高亮的对比图 |
| MCP | 让 AI 自动调用本工具，你不用敲命令 |
| 漂移 | 代码里有模块，六视图里漏画了 |

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
```

`setup` 会探测本机 Cursor / Claude Code / Claude Desktop / Windsurf，把 MCP 写进配置。  
然后：**完全退出并重启编辑器** → 打开 `$REPO` → 新开对话问：

> 列出你可用的 MCP 工具，有没有 arch-viewer？

应看到 **6 个工具**：

| 工具名 | 干什么 | 日常频率 |
|--------|--------|----------|
| `av_session_start` | 拍「改之前」照片 + 可选自动监听 | 每次开改前 |
| `av_session_changes` | 轻量：有没有架构变更（秒回） | AI 改完准备回复你前 |
| `av_session_report` | 完整报告 + HTML 对比图 | 出结果时 |
| `av_explain_finding` | 解释第 N 条红灯怎么修 | 有红灯看不懂时 |
| `av_archify_export` | 导出稀疏 Before/After JSON | 要喂 archify 出片时 |
| `av_check_layering` | 全仓历史串门清单 | **仅摸底一次** |

### 0.3（可选）生成六视图套件

若你还要「好看的分层架构图」给人看 / 给 PR 漂移用：

```bash
cd "$REPO"
arch-viewer init                 # 生成 architecture_viewer/ 套件
arch-viewer generate             # 骨架图，秒级，无需 API Key
# 可选精修（需 DEEPSEEK_API_KEY）：
# arch-viewer generate --refine
```

预览（不要用 `file://` 直接开 HTML）：

```bash
cd "$REPO/architecture_viewer"
python3 -m http.server 8080
# 浏览器打开 http://127.0.0.1:8080/architecture_visualized.html?tab=block
```

默认先看 **「分层模块 / Block」** Tab。

### 0.4 建议写入 `.gitignore`

```gitignore
.av/session-report.*
.av/session-report.builtin.html
.av/session-report.archify.html
```

可以提交（团队共享）：`.av/graph-baseline.json`、`.av/layers.json`、`architecture_viewer/` 下的六视图。

---

## 1. 功能全景：本工具到底能干什么

Architecture Viewer 不是「再画一张好看的图」那么简单，而是四条能力线：

```
┌─────────────────────────────────────────────────────────────┐
│  A. 会话验收门（主路径）                                       │
│     拍照 → AI 改码 → 对比图 + 风险 findings + 影响面            │
├─────────────────────────────────────────────────────────────┤
│  B. 六视图 / 分层图                                            │
│     init + generate：给人类看的 C4 / 分层 / 部署图              │
├─────────────────────────────────────────────────────────────┤
│  C. 漂移与 PR                                                  │
│     check --drift：代码有、图没有；CI 评论一键修复 Prompt       │
├─────────────────────────────────────────────────────────────┤
│  D. 运维信号（体量）                                           │
│     神文件 / 偏大 / 行数暴涨：Vibe Coding 防「千行大文件」      │
└─────────────────────────────────────────────────────────────┘
```

| 能力 | 解决什么痛 | 入口 |
|------|-----------|------|
| 会话基线 + 报告 | AI 改完我懒得读 diff | MCP / `session start|report` |
| Before / Delta / After 图 | 用颜色定位「改了哪」 | 报告 HTML（优先看 **builtin**） |
| 风险 findings | 串门、孤立实体、广泛影响、神文件 | 报告顶栏 + findings 列表 |
| 影响面 | 改一处牵动谁 | 报告「影响面」区块 |
| 六视图 | 给评审 / 新人看全景 | `init` + `generate` |
| 漂移检查 | 图跟不上代码 | `check --drift` / PR Action |
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

## 3. 日常主路径：拍照 → 改码 → 看报告

### 3.1 改之前：拍照

**对 AI：**

> 我要对 `$REPO` 做改动。请先 `av_session_start`，确认照片拍好了再动代码。

**CLI：**

```bash
arch-viewer session start "$REPO"
```

**返回里看什么：**

| 字段 | 意思 |
|------|------|
| files / types | 拍到多少文件、多少类型/组件 |
| fingerprint | 这张照片的编号 |
| savedTo | 一般在 `$REPO/.av/graph-baseline.json`（本地，不上传） |

拍完会尽量开启**自动监听**：你改代码停下约 20 秒后预生成报告；之后 `av_session_report` 可秒回缓存。

### 3.2 正常改业务

照常提需求。结构检查放在下一步，不要中途反复全量摸底。

### 3.3 改完：完整报告

**对 AI：**

> 改完了。请对同一路径 `av_session_report`。有红灯则对第 0 条 `av_explain_finding`（`from: "session"`），用人话讲谁串了谁、怎么修。绿灯就说「这次没改坏」。

**CLI：**

```bash
arch-viewer session report "$REPO" --open
# 强制只要带颜色的三栏：
arch-viewer session report "$REPO" --renderer builtin --open
```

**轻量轮询（可选）：**

```text
先 av_session_changes —— 若返回「有变更」再 av_session_report；若 analyzing 稍等再问。
```

---

## 4. 如何解读 HTML 报告（核心）

报告落在：

| 文件 | 是什么 | 你该不该看 |
|------|--------|------------|
| `.av/session-report.html` | 默认主入口；Archify 成功时是**好看成片** | 可看，但**不成色对比** |
| `.av/session-report.builtin.html` | **内置 Before / Delta / After** | **验收必看** |
| `.av/session-report.json` | 机器可读 diff + findings | 调试 / 二次处理 |

若主 HTML 是 Archify 成片，页顶可能有横幅：**「打开 Before / Delta / After」** → 点进 builtin。没有横幅时手动开 builtin 文件（或用 `--renderer builtin`）。

### 4.1 顶栏：风险灯与汇总卡

| 灯色 | 级别 | 你怎么决策 |
|------|------|-----------|
| 🟢 无风险 / none | 0 findings | 可提交；可选再 `session start` 刷新基线 |
| 🔵 低 / low | 偏大文件、增长较快、孤立实体等 | 知道即可，或记一笔技术债 |
| 🟠 中 / medium | 神文件、行数暴涨、广泛影响等 | 建议拆分或缩小改动面后再合 |
| 🔴 高 / high | 跨层违规、严重穿透等 | **先看清再提交**；或修掉再 report |

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
| `cross-layer-violation` | 🔴 | 不该跨的层连上了 | 抽中间层或改依赖方向 |
| `layer-skip` | 🔴 | 如 controller 直达 storage | 经 service 中转 |
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
- **关系**：新增 import、删除边、重连（类型变了）。  
- 显示「无关系变更」而顶栏仍有「新增关系」：常见是**归属边**（declared-in）被默认折叠；需要时 CLI 加 `--all`。

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

生成后优先看 Block。详细规范见套件内 `AGENT.md`。

### 6.2 漂移检查

```bash
arch-viewer check architecture_viewer --filled --drift --repo "$REPO"
```

| 结果 | 含义 |
|------|------|
| 绿 | 关键模块名能在图里找到 |
| 漂移 | 代码有、图没有（或规范未填满） |

PR 模板：`templates/architecture-check.yml`（见舆情教程 §9）。评论里会带**补哪张图 + 源码行号 + 一键修复 Prompt**。

---

## 7. CLI 对照表（心里有数）

| 做什么 | 让 AI（MCP） | 自己敲 |
|--------|--------------|--------|
| 拍照 | `av_session_start` | `arch-viewer session start` |
| 轻量有无变更 | `av_session_changes` | （看报告 / diff） |
| 完整报告 | `av_session_report` | `arch-viewer session report --open` |
| 强制三栏高亮 | — | `session report --renderer builtin --open` |
| 解释红灯 | `av_explain_finding` | 看 HTML findings |
| 全楼摸底 | `av_check_layering` | 日常不用 |
| 导出稀疏图 | `av_archify_export` | `arch-viewer archify-export` |
| 生成分层图 | — | `init` → `generate` |
| 漂移 | — | `check --filled --drift --repo .` |
| 影响面 | （含在 report） | `arch-viewer impact <base> <head> --open` |

引擎相同；MCP 只是让 AI 替你按节奏调用。

---

## 8. 复制给 AI 的固定口令（贴进 AGENTS.md / 用户规则）

把 `$REPO` 换成真实绝对路径：

```text
对项目 $REPO：
1. 动手改代码前：必须先 av_session_start（拍「改之前」照片）。
2. 改完准备收工：先 av_session_changes；有变更再 av_session_report。
3. 有红灯：av_explain_finding（from=session）用人话说明谁串了谁、跳了哪层、怎么改；修完再 report。
4. 不要用 av_check_layering 当每次验收（那是全楼历史扫描）。
5. 解释时避免堆术语：用「前台 / 中间层 / 仓库」「串门」「波及谁」「文件是不是又堆胖了」。
6. 用户确认报告无误后，再 av_session_start 刷新基线，开始下一轮。
```

之后你可以说：「按架构验收门改 xxx」，AI 应自动走完流程。

---

## 9. 绿灯 / 红灯之后你做什么

| 情况 | 你做什么 |
|------|----------|
| 🟢 绿灯 | 提交；可选再 `session start` 把基线推到「改之后」 |
| 🔴/🟠 不合理 | 让 AI 按建议改 → 再 `session report` |
| 🔴/🟠 你接受 | 记一句理由 → `session start`（等于认领现状） |
| 只改了注释 / 函数内部逻辑 | 报告可能「无结构变化」——正常 |
| 报告说 NO_BASELINE | 先 `session start` |

**不要**在未看报告时盲目刷基线——刷了等于把本轮问题「洗成正常」。

---

## 10. 五分钟最小路径（抄这个）

1. `npm i -g arch-viewer` → `cd $REPO` → `arch-viewer setup` → 重启编辑器  
2. 对话：「对绝对路径 `$REPO` 执行 `av_session_start`」  
3. 对话：「实现一个小改动……改完 `av_session_report`」  
4. 打开 `.av/session-report.builtin.html`（或页顶横幅进入）看 Delta  
5. 有红灯 →「`av_explain_finding` 第 0 条并给补丁」  
6. 你确认 OK →「再 `av_session_start` 刷新基线」

想练红灯又不碰真仓：把项目 rsync 到 `/tmp/xxx-demo`，在副本上故意加一行跨层 import，再走 session（参考 [MCP-DEMO-publicopinionmonitor.md](./MCP-DEMO-publicopinionmonitor.md) §3）。

---

## 11. 常见卡点

1. **Cursor 看不到 MCP** → 路径是否绝对路径、是否重启、MCP 面板是否报错。  
2. **NO_BASELINE** → 先 `av_session_start`。  
3. **一检查上百条红灯** → 误用了 `av_check_layering`；改回 `av_session_report`。  
4. **主 HTML 好看但看不出变化** → 打开 **builtin** 三栏，或 `--renderer builtin`。  
5. **改了代码却无变更** → 只动了函数体/文案/配置值，结构指纹不变，正常。  
6. **Delta 文字挤在一起** → 更新到含排版修复的版本并硬刷新浏览器（Cmd+Shift+R）。  
7. **仅违规是空的** → 本轮无跨层边，或语言提取不到类级边；先看 findings 文字列表。  
8. **体量规则从不亮** → 基线还是旧的（无 `lineCount`）；确认一轮报告后刷新基线即可。

---

## 12. 相关文档

| 文档 | 内容 |
|------|------|
| [MCP-DEMO-publicopinionmonitor.md](./MCP-DEMO-publicopinionmonitor.md) | 舆情仓逐步实战 + 故意串门练习 |
| [MCP-DEMO-publicopinionmonitor-short.md](./MCP-DEMO-publicopinionmonitor-short.md) | 同上极简版 |
| [SESSION-GUIDE.md](./SESSION-GUIDE.md) | 会话门小白指南（偏 CLI） |
| [OSS-TUTORIAL.md](./OSS-TUTORIAL.md) | 对开源仓跑 init/generate 画分层图 |
| [npm-publish.md](./npm-publish.md) | 发布 / 版本说明 |

---

## 13. 纯 CLI 速查（不用 MCP）

不想接 AI 编辑器、只想自己敲命令？完全没问题——以下四条命令覆盖日常主路径，引擎与 MCP 完全相同。

### 13.1 安装与初始化

```bash
npm i -g arch-viewer
cd $REPO

# 生成架构图（c4/block/class 等 Markdown 文件）
arch-viewer init
arch-viewer generate

# 拍基线快照（改码前执行）
arch-viewer session start
```

> 没装 MCP 不影响任何 CLI 功能；MCP 只是把这几条命令交给 AI 按节奏调用。

### 13.2 日常循环（三条命令）

```bash
# 1. 改码前拍快照（基线）
arch-viewer session start

# 2. 改码……（编辑器随意）

# 3. 改完看报告
arch-viewer session report --open
# 或强制三栏高亮版：
arch-viewer session report --renderer builtin --open
```

报告打开后看什么：
- **Delta 栏**：绿增 / 黄改 / 红删 / 紫移 / 青重命名；橙边 = 违规（呼吸发光）。
- **findings 表**：🔴 高 / 🟠 中 / 🔵 低，逐条给建议动作。
- **影响面**：波及了哪些下游模块。

### 13.3 一条命令版

如果你只记一条：

```bash
arch-viewer session start && arch-viewer session report --renderer builtin --open
```

改码前跑前半句拍基线，改码后跑后半句出报告。

### 13.4 CLI 与 MCP 对照

| 做什么 | CLI | MCP（AI 代劳） |
|--------|-----|----------------|
| 拍基线 | `session start` | `av_session_start` |
| 看变更 | `session report --open` | `av_session_report` |
| 解释红灯 | 看 HTML findings 表 | `av_explain_finding` |
| 导出稀疏图 | `archify-export` | `av_archify_export` |
| 漂移检查 | `check --filled --drift --repo .` | — |
| 影响面 | `impact <base> <head> --open` | 含在 report |

### 13.5 什么时候考虑接 MCP

- 改动频繁、想每次提交前自动验收 → 接 MCP 让 AI 按节奏跑。
- 偶尔用 / 团队 CI 用 → 纯 CLI 够了，报告 HTML 一样看。
- 多人协作需要 PR 评论 → 接 GitHub Actions + `check --drift`。

---

**记住一条线：**  
`session start` → 改码 → `session report`（看 **builtin** Delta + findings）→ 你点头 → 再 `session start`。  
其余功能都是这条线上的放大镜或团队插件。
