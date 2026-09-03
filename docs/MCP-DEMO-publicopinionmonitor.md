# MCP 实战：让 AI 自动帮你检查项目（逐步教程）

> **一句话**：配置一次之后，AI 改代码前自动拍照片、改完自动检查有没有改坏，你不用敲任何命令。
> 实测项目：舆情监控仓 `publicopinionmonitor_v2`，约 246 个文件。

## 三步速览（整个工具就这三件事）

### ① 装一次，以后不用管

- **⚡ 一键安装**：`arch-viewer setup` · 自动配置 Cursor / Claude，你不用编辑任何配置文件。
- **📝 贴一句口令给 AI**：

  > 「以后改我的代码之前，先拍照片；改完之后检查有没有改坏。有问题用大白话告诉我。」

- 之后 AI 全自动，你只管说话。

### ② 每次改代码，AI 自动做这三步

| 步骤 | 工具 | 说明 |
|------|------|------|
| 📷 拍照 | `av_session_start` | 改之前记下结构 |
| 🔨 AI 改代码 | （你只管说话） | 正常提需求 |
| 📋 对比 + 红绿灯 | `av_session_report` | 改完后自动检查 |

- 🟢 绿灯 = 没改坏
- 🟡 黄灯 = 注意
- 🔴 红灯 = 要看

### ③ 有红灯时按需用

| 工具 | 用途 |
|------|------|
| 🔍 `av_explain_finding` | 看红灯详情 · 谁串门了、怎么修 |
| 🏗️ `av_check_layering` | 查全楼老问题 · 第一次摸底用（日常不要用） |

---

## 这个工具怎么工作的？（看图就懂）

```
  你跟 AI 说改什么          AI 自动拍照           AI 改代码           AI 自动检查
 ┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 │ "帮我加一个   │  →   │ 📷 咔！      │  →   │ 🔨 改代码中   │  →   │ 📋 对比照片   │
 │  导出功能"    │      │ 拍"改之前"   │      │              │      │ 绿灯=没问题   │
 │              │      │ 的照片       │      │              │      │ 红灯=改坏了   │
 └──────────────┘      └──────────────┘      └──────────────┘      └──────────────┘
```

**你只需要说人话，AI 自己走完整流程。**

---

## 术语速查（遇到看不懂的词，回来查这里）

| 你会看到的词 | 大白话 |
|-------------|-------|
| 拍照片 / 基线 | 记录"改之前"的结构 |
| 指纹 | 照片的编号，变了 = 结构改了 |
| 楼层 / 分层 | 把文件分成前台、中间层、仓库等 |
| 串门 / 跨层 | 前台直接跑去仓库，不走中间层 |
| 红灯 / 绿灯 | 红灯 = 可能改坏了，绿灯 = 没问题 |
| 波及范围 | 改了一个地方，哪些会跟着受影响 |
| MCP | 让 AI 能自动调用检查工具 |

---

## 0. 一次性准备

### 0.1 确认工具能跑

```bash
cd ~/Desktop/architecture_viewer
npm install   # 装过可跳过
node mcp/server.js   # 会挂起等输入；Ctrl+C 关掉即可，只证明文件在
```

记死两个路径（后面要用绝对路径）：

```
工具：/Users/yanheyang/Desktop/architecture_viewer/mcp/server.js
项目：/Users/yanheyang/Desktop/publicopinionmonitor_v2
```

### 0.2 接入 Cursor（推荐先试这个）

编辑 `~/.cursor/mcp.json`，加上一段：

```json
{
  "mcpServers": {
    "arch-viewer": {
      "command": "node",
      "args": [
        "/Users/yanheyang/Desktop/architecture_viewer/mcp/server.js"
      ]
    }
  }
}
```

然后：

1. **完全退出**并重新打开 Cursor
2. 打开文件夹：`~/Desktop/publicopinionmonitor_v2`
3. 新开 AI 对话，问一句：**「列出你可用的 MCP 工具，有没有 arch-viewer？」**

应能看到 5 个工具：

| 工具名 | 干什么用的 |
|-------|-----------|
| `av_session_start` | 拍"改之前"的照片，并开启自动监听 |
| `av_session_changes` | 轻量检查有没有架构变更（秒回，改完代码回复前用） |
| `av_session_report` | 看完整报告（Before/After 对比图）；自动监听已生成则秒回 |
| `av_check_layering` | 查全楼所有历史问题（第一次摸底用） |
| `av_explain_finding` | 解释某条红灯的详情和修法 |

### 0.3 接入 DeepSeek Harness（可选）

见仓库内 [mcp/dsh-config.example.yml](../mcp/dsh-config.example.yml)，把路径换成上面的绝对路径即可。

### 0.4 命令行确认工具能用（可选）

不用 Cursor 也能确认工具正常：

```bash
export AV="$HOME/Desktop/architecture_viewer"
export REPO="$HOME/Desktop/publicopinionmonitor_v2"

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node "$AV/mcp/server.js"
```

能打印出 5 个工具的信息就成功了。

---

## 1. 第一次摸底（只做一次，可选）

**你对 AI 说：**

> 对仓库 `/Users/yanheyang/Desktop/publicopinionmonitor_v2` 调用 `av_check_layering`，用中文总结：多少文件被识别了、分了几个楼层、红灯大概多少条。不要逐条念 200 多条，只给前 5 条样例 + 说明这些是历史老问题。

**AI 会调用：** `av_check_layering`

**实测结果：**

| 项 | 结果 |
|----|------|
| 文件数 | 246 |
| 楼层识别率 | 94%（大部分文件已分到楼层） |
| 红灯数 | 约 218 条（历史老问题） |

**你怎么理解：**

```
  这栋大楼以前就有很多"串门"现象
  ┌──────────────────────────────────┐
  │  不是今天 AI 改出来的！           │
  │  是项目历史积累的老问题。          │
  │  以后每次改功能，不用看这个数字。  │
  │  用第 2 节的"只看这次"来验收。    │
  └──────────────────────────────────┘
```

---

## 2. 日常用法：改功能前 → 改完 → 检查

这是你反复用的三句话。

### 步骤 A — 改代码之前（拍照片）

**你说：**

> 我要对舆情监控项目做改动。请先对
> `/Users/yanheyang/Desktop/publicopinionmonitor_v2`
> 调用 `av_session_start`，确认照片拍好了，然后再动代码。

**AI 会调用：** `av_session_start`

**实测返回（节选）：**

```json
{
  "baseline": {
    "files": 246,
    "types": 1543,
    "fingerprint": "540d963c8c014084",
    "savedTo": ".../publicopinionmonitor_v2/.av/graph-baseline.json"
  },
  "message": "已经拍好了\"改之前\"的照片（246 个文件、1543 个组件）..."
}
```

**翻译成人话：**

| 输出 | 意思 |
|------|------|
| 246 files, 1543 types | 你的项目有 246 个文件、1543 个组件 |
| fingerprint | 照片的编号，变了就说明结构改了 |
| savedTo | 照片存在你项目的 `.av` 文件夹里，不上传云端 |

### 步骤 B — 正常改业务

照常让 AI 改你需要的东西，比如：

> 在 alerts 相关能力上加一个导出接口……

你只管看业务对不对，结构检查放在下一步。

### 步骤 C — 改完检查（只看这次改了什么）

**你说：**

> 改完了。请对同一路径调用 `av_session_report`。
> 如果有红灯，再对第 0 条调用 `av_explain_finding`（`from: "session"`），用大白话告诉我谁串了谁的门、建议怎么改。
> 如果是绿灯，直接说「这次没改坏」。

**AI 会调用：** `av_session_report` →（有红灯时）`av_explain_finding`

**如果什么都没改、刚拍完照片就检查：** 应该是绿灯——说明结构没动，正常。

**报告里你看什么：**

```
┌────────────────────────────────────┐
│  ① 变化汇总                         │
│  +新增 3  -删除 1  ~修改 2         │
├────────────────────────────────────┤
│  ② 红绿灯                           │
│  🔴 红灯 = 必须看（可能改坏了）     │
│  🟠 黄灯 = 建议看（有点担心）        │
│  🔵 蓝灯 = 随便看（小问题）          │
│  ✅ 绿灯 = 没问题                   │
├────────────────────────────────────┤
│  ③ 波及范围                         │
│  改了A → B、C 会跟着受影响          │
└────────────────────────────────────┘
```

---

## 3. 隔离演示：故意"串门"看看红灯（不改你的真实项目）

用临时副本做演示，**不碰桌面上的真实项目**。

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

# 用 MCP 拍照片
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"av_session_start","arguments":{"repo":"'"$DEMO"'"}}}' \
  | node "$AV/mcp/server.js"

# 模拟 AI 犯的错：前台直接连仓库
printf '\nfrom database.db_session import get_async_engine  # demo\n' \
  >> "$DEMO/backend/routes/alerts.py"

# MCP 检查
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"av_session_report","arguments":{"repo":"'"$DEMO"'"}}}' \
  | node "$AV/mcp/server.js"
```

### 3.2 实测结果

**检查报告：**

- 新增走廊：`alerts.py ──引用──> db_session.py`
- 红灯：1 条 🔴 串门（前台 → 仓库，跳过了中间层）

```
  前台层              中间层              仓库层
┌──────┐           ┌──────┐          ┌──────┐
│alerts│ ──红色箭头────────────────→ │db_   │
│.py   │   ❌ 串门！跳过了中间层！      │session│
└──────┘           └──────┘          └──────┘
                   应该走这里 ↗
```

**红灯详情：**

| 字段 | 实测 |
|------|------|
| 谁串门 | `backend/routes/alerts.py`（前台层） |
| 串到哪 | `database/db_session.py`（仓库层） |
| 怎么连的 | 引用（import），约第 138 行 |
| 怎么修 | 中间加一层"中间人"来中转，不要前台直连仓库 |

### 3.3 在 Cursor 里用"人话"复现同一逻辑

对 AI 说（务必强调 `/tmp`）：

> 请只在 `/tmp/pom-mcp-demo` 上操作，不要改桌面上的舆情仓。
> 1）`av_session_start`
> 2）在 `backend/routes/alerts.py` 末尾加一行 `from database.db_session import get_async_engine`
> 3）`av_session_report`，有红灯则 `av_explain_finding`
> 4）解释完后**撤销**那一行，再检查一次确认变绿

---

## 4. 推荐你复制给 AI 的"固定口令"

放到 Cursor 用户规则 / 项目 `AGENTS.md` 里一段即可：

```text
对舆情仓 /Users/yanheyang/Desktop/publicopinionmonitor_v2：
- 动手改代码前：必须先 av_session_start（拍"改之前"的照片）
- 改完准备收工：必须 av_session_report（看有没有改坏）；有红灯则 av_explain_finding 后再改或说明为什么可接受
- 不要用 av_check_layering 当每次检查（那是查全楼历史问题，会刷 200 多条）
- 解释问题时用人话：谁串了谁、跳了哪层、怎么改
```

之后你只要说：「按架构验收门改 xxx」，AI 就会自己走完整流程。

---

## 5. 检查通过后你做什么

| 情况 | 你做什么 |
|------|---------|
| 绿灯 ✅ | 可以提交；可选让 AI 再 `av_session_start` 拍新照片 |
| 有红灯 🔴，你觉得不合理 | 让 AI 按修复建议改，再 `av_session_report` |
| 有红灯 🔴，你觉得合理 | 记一句理由，然后 `av_session_start` 拍新照片（这个问题被"认领"了） |

建议在项目 `.gitignore` 加：

```gitignore
.av/session-report.*
```

`graph-baseline.json`（团队共享同一张照片）和 `layers.json`（楼层规则）可以提交。

---

## 6. 和命令行对照（心里有数就行）

| 做什么 | 让 AI 自动 | 自己敲命令 |
|-------|-----------|-----------|
| 拍照片 | `av_session_start` | `node …/cli.js session start $REPO` |
| 看这次改了什么 | `av_session_report` | `node …/cli.js session report $REPO --open` |
| 查全楼历史问题 | `av_check_layering` | 日常不用 |
| 解释一条红灯 | `av_explain_finding` | 看 HTML 报告 |

检查引擎完全一样，只是一个让 AI 自动跑，一个你自己跑。

---

## 7. 常见卡点

1. **Cursor 看不到工具** → 检查 `mcp.json` 里的路径对不对、重启 Cursor、看 MCP 面板有没有报红。
2. **报告说 NO_BASELINE** → 先让 AI `av_session_start` 拍照片。
3. **一检查就 200 多条红灯** → 你用了 `av_check_layering`（查历史）；改回 `av_session_report`（只看这次）。
4. **改了代码但报告说无变更** → 只改了函数内部、注释、配置值，结构没变，正常。

---

## 8. 五分钟最小路径（抄这个）

1. 配置 Cursor `mcp.json` → 重启 → 打开 `publicopinionmonitor_v2`
2. 对话：「对本仓绝对路径 `av_session_start`」
3. 对话：「实现一个小改动……改完 `av_session_report`」
4. 有红灯 →「`av_explain_finding` 第 0 条，并给出补丁」
5. 绿了 →「再 `av_session_start` 拍新照片」

想先练红灯再动真仓：用第 3 节的 `/tmp/pom-mcp-demo`。
