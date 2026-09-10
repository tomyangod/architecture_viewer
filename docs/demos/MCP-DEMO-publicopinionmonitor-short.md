# 舆情仓 MCP 速查（1 页）

> 通用安装 / 7 工具 / 读报告 / CI → [Quickstart](../guides/quickstart.md)。  
> 完整实战（摸底数字 + `/tmp` 串门）→ [MCP-DEMO 完整版](./MCP-DEMO-publicopinionmonitor.md)。  
> 适用：**0.11.2+** · 实测仓 `publicopinionmonitor_v2`。

---

## 1. 先打通通用路径

```bash
npm i -g arch-viewer          # 或 npx arch-viewer@0.11.2
cd ~/Desktop/publicopinionmonitor_v2   # 换成你的绝对路径
arch-viewer setup
```

重启编辑器，打开**该仓**，问：「列出 arch-viewer 的 MCP 工具」。应看到 **7 个**（含 `av_session_changes`、`av_status`）。细节：[Quickstart §0.2](../guides/quickstart.md#02-打开目标项目并一键接入-ai)。

---

## 2. 该仓三步

| 何时 | 对 AI 说 |
|------|----------|
| 开改前 | 对当前工作区 `av_session_start`，显式传绝对路径 `repo`，回显 `path.checking` |
| 改完 | `av_session_report`；有红灯则 `av_explain_finding`（`from: "session"`） |
| 你确认 OK | 再 `av_session_start` 刷新基线 |

日常**不要**用 `av_check_layering`（全仓历史债会刷很多条）。

---

## 3. 练红灯（可选）

真仓别乱动。完整版 [§3](./MCP-DEMO-publicopinionmonitor.md#3-隔离练习故意串门看红灯不碰真仓) 有 `/tmp/pom-mcp-demo` 脚本：复制仓 → 在 `alerts.py` 加一行直连 `db_session` → report 看红灯 → 撤销再绿。

---

## 4. 卡点

| 现象 | 处理 |
|------|------|
| 看不到 7 个工具 | 路径是否绝对、是否重启；见 Quickstart §11 |
| 一检查上百条红灯 | 误用了摸底工具；改回 `av_session_report` |
| 想接 PR 漂移 | [Quickstart §6](../guides/quickstart.md#6-六视图与漂移新项目可选) |
