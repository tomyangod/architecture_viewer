# 会话架构验收门：小白实战教程（0.10.0）

> 适用场景：你让 Cursor / DeepSeek Harness / AI 改自己的项目，改完想知道「项目结构有没有被改坏」。
> 本教程以本地舆情监控仓 `publicopinionmonitor_v2` 为例，全程**不改动你的源码**。
> 工具不替你跑业务，它只回答两件事：**这次 AI 改完，结构动了没有、有没有违规。**

**两种用法，选一种：**

| 用法                      | 你要做什么                                | 适合谁                                     |
| ----------------------- | ------------------------------------ | --------------------------------------- |
| **A. CLI 手动**（第 1–3 节）  | 改前敲一条命令拍基线，改后敲一条命令看报告                | 想自己掌控节奏、或要接 CI                          |
| **B. MCP 自动**（第 7 节，推荐） | 配置一次，之后 **Agent 自己**在改前拍基线、改后自查，你零命令 | 用 Cursor / Claude / DeepSeek Harness 的人 |

两种用法底层是同一套引擎，结论完全一致。

***

## 0. 准备（只做一次）

```bash
cd ~/Desktop/architecture_viewer
npm install          # 若以前装过依赖可跳过
```

后面命令都用「工具仓里的 CLI」去扫「你的项目仓」，**不必**把工具装进项目仓。

设两个变量方便复制（按你的实际路径改）：

```bash
export AV="$HOME/Desktop/architecture_viewer"
export REPO="$HOME/Desktop/publicopinionmonitor_v2"
```

***

## 1. 开干前：拍一张「改之前」的快照

```bash
node "$AV/lib/cli.js" session start "$REPO"
```

**0.9.0 的实际输出（246 文件的 Python 爬虫仓）：**

```
Baseline recorded: 246 files, 1543 types
Fingerprint: 540d963c8c014084
Saved to: <你的仓>/.av/graph-baseline.json
Layer suggestions: <你的仓>/.av/layers.suggested.json   ← 新增
  (自动分层推断，审阅即可；复制为 .av/layers.json 可锁定)
```

**讲解：**

- 快照存在你项目仓的 `.av/` 里，**不上传云端**。

- 指纹用来判断「结构有没有变」，不是 git commit。

- 基线拍的是**当前工作区**（包括你未提交的改动），不是 `origin/master`。

### 🆕 0.9.0 智能化：分层不用你配了

旧版只靠文件夹名猜分层，像 `database/`、`data_collection/` 这种名字会漏判。
0.9.0 改成**四信号自动推断**（import 了什么框架 + 文件夹名 + 文件名 + 被谁依赖），
`session start` 后自动生成 `.av/layers.suggested.json`，本次真实识别结果：

| 目录                         | 自动判定            | 置信度 | 依据                   |
| -------------------------- | --------------- | --- | -------------------- |
| `database/`（5 个文件）         | **storage 存储层** | 高   | 目录名 + 内置规则           |
| `data_collection/`（24 个文件） | **service 服务层** | 高   | 爬虫/采集词根              |
| `backend/routes/`          | controller 控制层  | 高   | flask 路由 + import 语义 |

**你什么都不用做**——建议文件自动生效。只有觉得判错了，才打开它改。

***

## 2. 日常习惯（真正要养成的三步）

```bash
# ① 让 AI 改代码之前：拍基线
node "$AV/lib/cli.js" session start "$REPO"

# ② AI 改完、你准备验收：看报告
node "$AV/lib/cli.js" session report "$REPO" --open

# ③ 报告里的变更你认可后：再拍一次基线，开启下一轮
node "$AV/lib/cli.js" session start "$REPO"
```

`--open` 会用浏览器打开 `.av/session-report.html`，点「仅变更」只看这次动了什么。

**刚拍完基线立刻 report，大概率是「无变更 / Risk NONE」**——这是正常的绿灯，说明结构没动。

### 报告里重点看三块

1. **顶部汇总**：`+新增 -删除 ~修改` 节点/边/类型数量
2. **风险发现**：🔴 高 / 🟠 中 / 🔵 低。🔴 必须逐条看
3. **影响面**：被改的模块会波及哪些下游（改一处会不会牵动一片）

***

## 3. 演示：AI「改坏了一条边」，现在会亮红灯 ✅

> 这一步在 `/tmp` 隔离副本里做，**不碰你桌面上的源码**。

```bash
# 复制一份到临时目录（排除虚拟环境、日志、缓存）
rm -rf /tmp/pom-av-demo
rsync -a --exclude='.venv' --exclude='node_modules' --exclude='__pycache__' \
      --exclude='logs' --exclude='.av' --exclude='*.log' \
      "$REPO"/ /tmp/pom-av-demo/

# 给副本拍基线
node "$AV/lib/cli.js" session start /tmp/pom-av-demo

# 模拟 AI 犯的典型错误：路由层（controller）直接 import 数据库层（storage），
# 跳过了 service 层
printf '\nfrom database.db_session import get_async_engine\n' \
  >> /tmp/pom-av-demo/backend/routes/alerts.py

# 看报告
node "$AV/lib/cli.js" session report /tmp/pom-av-demo --open
```

**0.9.0 实际检出：**

```
--- 新增关系 ---
  + file:backend/routes/alerts.py --import--> file:database/db_session.py

--- 风险发现 ---
  🔴 [HIGH] 层级穿透: 控制器 直接访问 存储，跳过了服务层
     alerts.py → db_session.py (import)

Risk level: HIGH (1 findings)
```

**命令退出码为 1**——这意味着可以接进 CI，红灯时自动拦住 PR。

### ⚠️ 与旧版（0.8.x）的区别

旧版这里**不亮红灯**：工具看见了新增的 import，但因为 `database/` 没被识别成存储层，
无法判定「跨层」。0.9.0 靠自动分层推断修复了这个漏报——现在控制器直连数据库会被准确抓出。

***

## 4. 万一分层判错了怎么办（少见，但要知道）

绝大多数项目零配置即可。如果某个目录判得不对：

1. 打开 `<仓>/.av/layers.suggested.json`，找到那个目录，看它现在判成什么、依据什么信号
2. 把文件**复制**为 `<仓>/.av/layers.json`，改成你要的层，例如：

```json
{
  "mydata": "storage",
  "helpers": "util"
}
```

1. 重新 `session start`。`layers.json` 优先级最高，且永远不会被工具覆盖。

> 注意：`layers.suggested.json` 是工具给的**建议**（可随时重新生成）；
> `layers.json` 是你的**正式决定**（锁定后工具不碰）。

***

## 5. .gitignore 建议

在你的项目仓 `.gitignore` 里加一行，避免把 HTML 报告提交进去：

```gitignore
.av/session-report.*
```

- `graph-baseline.json`：**建议提交**，作为团队共享基线（大家对照同一条线）

- `layers.json`：**建议提交**，团队共享分层规则

- `layers.suggested.json`、`session-report.*`：本地生成，可不提交

***

## 6. 可选：在编辑器里用（不用敲命令）

1. Cursor / VS Code 打开 `architecture_viewer`，按 **F5** 开扩展开发窗口
2. 在新窗口打开你的项目仓
3. 命令面板执行 `Architecture Viewer: Session Start`
4. 改代码后，状态栏角标会自动显示 `+新增 -删除 ~修改` 和风险数（高风险红底）
5. 点角标直接打开报告；或执行 `Architecture Viewer: Session Report`

扩展和 CLI 是同一套分析引擎，只是用角标代替你敲命令。代码停止变更约 30 秒后自动分析（防抖）。

---

## 7. MCP 模式：让 AI Agent 自动验收（零命令，推荐）

0.10.0 起，AV 可以作为 **MCP 工具**挂到 AI Agent 上（Cursor / Claude / **DeepSeek Harness** / Codex 等任何支持 MCP 的客户端）。
配置一次后，**Agent 自己**在改代码前拍基线、改完自查，你不用敲任何命令。

### 7.1 它和 CLI 的区别

| | CLI 手动（第 2 节） | MCP 自动（本节） |
|---|---|---|
| 谁拍基线 | 你敲 `session start` | Agent 改代码前自动调 `av_session_start` |
| 谁验收 | 你敲 `session report` | Agent 改完自动调 `av_session_report` / `av_check_layering` |
| 你要做的 | 记住三步、敲三条命令 | 配置一次，之后正常和 Agent 对话即可 |
| 违规解释 | 你自己看 HTML | Agent 调 `av_explain_finding` 拿到事实，再用大白话解释 + 给修法 |

### 7.2 Agent 手里有哪 4 个工具

| 工具 | Agent 什么时候调 | 返回什么 |
|---|---|---|
| `av_session_start` | 动手改代码**之前** | 基线指纹 + 自动分层建议 |
| `av_session_report` | 改完**之后**验收 | 本次变更的 diff + 风险 + 影响面（**只看这次改动**，低噪音） |
| `av_check_layering` | 想快速自查时（不需基线） | 全仓跨层违规（**存量摸底**，会列出历史债） |
| `av_explain_finding` | 想搞清某条违规时 | 谁→谁、哪条边、依据什么分层、修复建议 |

> **两个检测工具的分工**（重要）：
> - `av_session_report` 只报**本次会话新引入**的违规——日常验收用它，不会被历史代码打扰。
> - `av_check_layering` 报**全仓存量**违规。例如舆情仓首次跑会报 218 条，那是项目历史累积的分层债，
>   不是你这次改出来的。适合第一次摸底，不适合每次验收。

### 7.3 接入 DeepSeek Harness（dsh）

dsh 是开源 agent harness，通过 `@deepseek-ai/dsh-mcp-client` 插件接标准 MCP server。
配置示例见 [mcp/dsh-config.example.yml](../mcp/dsh-config.example.yml)，核心一段：

```yaml
# 加到 ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: mcp-arch-viewer
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: arch-viewer
        transport: stdio
        command: node
        args:
          - /你的路径/architecture_viewer/mcp/server.js
```

重启 dsh 后，在对话里问「列出你可用的工具」，应能看到
`mcp__arch-viewer__av_session_start` 等 4 个工具。

### 7.4 接入后怎么用（你只需要说人话）

配置好后，正常给 Agent 派活就行，例如：

> 「帮我给 alerts 路由加一个导出功能。改之前先用 arch-viewer 拍基线，改完检查有没有跨层违规。」

Agent 会自己：调 `av_session_start` → 改代码 → 调 `av_session_report` →
如果有 🔴，调 `av_explain_finding` 搞清事实 → 用大白话告诉你「我在路由里直连了数据库层，
跳过了 service，建议改成走 XxxService」。

**这就是 MCP 相对 CLI 的核心简化**：你不需要知道"基线""分层""diff"这些概念，
也不需要在改代码和验收之间切换工具——验收变成了 Agent 工作流里自动的一步。

### 7.5 命令行手动验证 MCP（可选）

不装 dsh 也能确认 server 正常（模拟 Agent 的 stdio 调用）：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"av_check_layering","arguments":{"repo":"'"$REPO"'"}}}' \
  | node "$AV/mcp/server.js"
```

舆情仓实测返回：94% 分层覆盖、4 个工具正常注册、218 条存量违规可被 Agent 读取。

---

## 8. 常见问题

**Q：报告显示「无变更」，但我明明改了代码？**
改的是函数内部实现、注释、配置值——结构（文件/类/函数/依赖关系）没变，所以不报。这是对的：
结构没变就不打扰你。

**Q：红灯一定是错吗？**
不一定。🔴 表示「这里有一个值得你亲眼看一下的结构变化」。有时控制器直连数据库是有意为之，
你确认合理后，刷新基线即可——工具负责**让你看见**，判断权在你。

**Q：扫描会不会很慢 / 要联网 / 要 API Key？**
246 文件约 1～2 秒扫完；完全离线、零依赖、不需要任何 Key。

**Q：第一次想练手，怕搞坏真实仓？**
先用第 3 步的 `/tmp` 副本练，跑顺了再对真实仓用。
