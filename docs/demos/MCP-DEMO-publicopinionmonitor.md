# 实战附录：舆情监控仓（MCP）

> **定位**：本文不是通用教程。安装、7 个 MCP 工具、日常闭环、读报告、PR 漂移 → 一律看 [Quickstart](../guides/quickstart.md)。  
> **本文只保留**：对 `publicopinionmonitor_v2` 的实测数字、`/tmp` 故意串门练习、该仓专用口令。  
> **适用版本**：arch-viewer **0.11.2+** · 文内规模数字来自 2026-09 一次实测，仅作参考。

---

## 0. 开始前

1. 按 [Quickstart §0](../guides/quickstart.md#0-一次性准备新项目) 装好工具并 `setup`。  
2. 编辑器打开的工作区必须是舆情仓根目录（或下文 `/tmp` 副本），**不要**沿用工具仓 / 主仓绝对路径。  
3. 下文占位：

```bash
export AV="$HOME/Desktop/architecture_viewer"          # 工具仓（源码调试时）
export REPO="$HOME/Desktop/publicopinionmonitor_v2"    # 舆情业务仓——按你的本机路径改
```

MCP 每次调用都要显式传当前工作区绝对路径 `repo`（等于 `$REPO` 或 `/tmp/pom-mcp-demo`）。

---

## 1. 实测摸底（只做一次，可选）

**对 AI 说：**

> 对仓库 `$REPO` 调用 `av_check_layering`，用中文总结：多少文件、几个楼层、红灯大约多少。不要逐条念，只给前 5 条样例，并说明这些是历史老问题。

**某次实测（2026-09，仅供对照，勿当规格）：**

| 项 | 结果 |
|----|------|
| 文件数 | 246 |
| 组件 / 节点 | 1543 个组件 · 1885 个节点 · 3652 条关系 |
| 楼层识别率 | 约 94% |
| 全仓历史红灯 | 约 218 条 |

这些是**历史债**，不是今天 AI 改出来的。日常验收只用 `av_session_report`（只看本轮），不要再用 `av_check_layering` 当每次检查。解读方式见 [Quickstart §2](../guides/quickstart.md#2-第一次摸底只做一次可选)。

---

## 2. 该仓日常三句话

装好 MCP 之后，对 AI：

1. **开改前**：「对 `$REPO` 调用 `av_session_start`，回显 `path.checking`，确认是本仓再动代码。」  
2. **改完**：「对同一路径 `av_session_report`；有红灯则对第 0 条 `av_explain_finding`（`from: "session"`），用人话讲谁串了谁。」  
3. **你确认 OK**：「再 `av_session_start` 刷新基线。」

报告怎么读、绿灯/红灯之后做什么 → [Quickstart §3–§4、§9](../guides/quickstart.md#3-日常主路径拍照--改码--看报告)。

---

## 3. 隔离练习：故意串门看红灯（不碰真仓）

用临时副本演示，**不要改桌面上的真实舆情仓**。

### 3.1 一键复现

```bash
export AV="$HOME/Desktop/architecture_viewer"
export REPO="$HOME/Desktop/publicopinionmonitor_v2"
DEMO=/tmp/pom-mcp-demo

rm -rf "$DEMO"
rsync -a --exclude='.venv' --exclude='node_modules' --exclude='__pycache__' \
  --exclude='logs' --exclude='.av' --exclude='.git' --exclude='cache' \
  --exclude='runtime' --exclude='backups' --exclude='browser_data' \
  "$REPO"/ "$DEMO/"

# 拍照片（显式传 DEMO 绝对路径）
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"av_session_start","arguments":{"repo":"'"$DEMO"'"}}}' \
  | node "$AV/mcp/server.js"

# 模拟 AI 犯错：前台直接连仓库
printf '\nfrom database.db_session import get_async_engine  # demo\n' \
  >> "$DEMO/backend/routes/alerts.py"

# 出报告
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"av_session_report","arguments":{"repo":"'"$DEMO"'"}}}' \
  | node "$AV/mcp/server.js"
```

已全局安装 CLI 时，也可把管道换成：

```bash
arch-viewer session start "$DEMO"
# …加那一行 import…
arch-viewer session report "$DEMO" --open
```

### 3.2 预期现象

- 新增依赖边：`backend/routes/alerts.py` → `database/db_session.py`  
- 至少 1 条 🔴 跨层 / 串门类 finding（前台 → 仓库，跳过中间层）  
- `av_explain_finding`（`from: "session"`）应指出谁串谁、建议经中间层中转  

若没有红灯：核对副本路径、分层是否识别到 `routes` / `database`，或先看 findings 原文再对照 [Quickstart §11](../guides/quickstart.md#11-常见卡点)。

### 3.3 在 Cursor 里用人话复现

> 请只在 `/tmp/pom-mcp-demo` 上操作，不要改桌面上的舆情仓。  
> 1）`av_session_start`（`repo` = 该绝对路径）  
> 2）在 `backend/routes/alerts.py` 末尾加一行 `from database.db_session import get_async_engine`  
> 3）`av_session_report`；有红灯则 `av_explain_finding`（`from: "session"`）  
> 4）解释完后**撤销**那一行，再 report 一次确认变绿  

---

## 4. 该仓专用口令（可贴进 AGENTS.md）

把 `$REPO` 换成你的绝对路径后再贴：

```text
对舆情仓 <把绝对路径写在这里>：
- 动手改代码前：必须先 av_session_start，并显式传当前工作区绝对路径 repo；回显 path.checking
- 改完准备收工：必须 av_session_report；有红灯则 av_explain_finding（from: session）后再改或说明为什么可接受
- 不要用 av_check_layering 当每次检查（那是全仓历史债，会刷上百条）
- 解释问题时用人话：谁串了谁、跳了哪层、怎么改
```

通用口令模板见 [Quickstart §8](../guides/quickstart.md#8-复制给-ai-的固定口令贴进-agentsmd--用户规则)。

---

## 5. 相关文档

| 文档 | 内容 |
|------|------|
| [quickstart.md](../guides/quickstart.md) | **唯一**通用怎么用：安装、7 工具、读报告、CI |
| [MCP-DEMO-publicopinionmonitor-short.md](./MCP-DEMO-publicopinionmonitor-short.md) | 本附录的一页速查 |

团队 PR 漂移 / `check --drift` → [Quickstart §6](../guides/quickstart.md#6-六视图与漂移新项目可选)，本文不再复述。
