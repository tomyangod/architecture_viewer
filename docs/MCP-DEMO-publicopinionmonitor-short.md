# MCP 极简上手（舆情监控仓实战）

> 一句话：AI 改代码前自动拍快照、改完自动检查有没有改坏。  
> 实测仓：`publicopinionmonitor_v2`（246 文件 · 1543 组件 · 1885 节点）  
> 适用版本：arch-viewer **0.11.0** · 2026-09-05

---

## 1. 装一下（2 分钟）

```bash
npm i -g arch-viewer
cd ~/Desktop/publicopinionmonitor_v2
arch-viewer init     # 生成 architecture_viewer/ 六视图
arch-viewer setup    # 自动配 Cursor / Claude Code / Desktop / Windsurf
```

重启编辑器，问 AI：「列出 arch-viewer 的 MCP 工具」。看到 6 个就成功。

## 2. 6 个工具，记住 3 个就够

| 工具 | 一句话 | 什么时候用 |
|------|--------|-----------|
| `av_session_start` | 拍"改之前"的照片 | 开改之前 |
| `av_session_changes` | 轻量检查有没有架构变更（秒回） | AI 改完代码、回复你之前 |
| `av_session_report` | 完整 Before/After 对比图 + 红灯列表 | 出结果时 |
| `av_explain_finding` | 解释某条红灯的详情和修法 | 红灯看不懂时 |
| `av_archify_export` | 导出稀疏架构图 JSON 给 archify 出图 | 要出图时 |
| `av_check_layering` | 查全楼所有历史问题 | **第一次摸底用，日常不要** |

## 3. 日常工作流（三步）

1. **开改前**：告诉 AI「先 `av_session_start` 拍张照」
2. **改完了**：AI 自己用 `av_session_changes` 查，绿了再告诉你
3. **看结果**：「给我 session report」→ 打开 HTML 看 Before/After 对比图

绿灯（+1~5 个节点，0 红灯）= 架构没变坏，继续。  
红灯 = 跨层串门了，用 `av_explain_finding` 看怎么修。

## 4. PR 自动抓"图和代码对不上"

团队场景：把 CI 挂上，谁提 PR 漏更了架构图，机器人自动评论。

接入（一次）：

```bash
mkdir -p .github/workflows
curl -fsSL https://gitee.com/heyangyan/architecture_viewer/raw/master/templates/architecture-check.yml \
  -o .github/workflows/architecture-check.yml
```

PR 评论示例：

```
漂移 1 项：
- module `backend/services` → 补入 block-diagram.md（分层模块图）
  · 源码 backend/services/__init__.py:1

一键修复 Prompt：（复制给 AI 编辑器自动补图）
```

每条漂移都带：**目标视图** + **源码行号** + **一键修复 prompt**。

本地先自测：`arch-viewer check architecture_viewer --filled --drift --repo .`

## 5. 常见问题

- **红灯很多怎么办？** 老仓历史问题正常，session 报告只看"新增红灯"。
- **图生成不准？** `arch-viewer generate` 重新生成；人工改图后 AI 会接着维护。
- **想手动配？** 见完整版 `docs/MCP-DEMO-publicopinionmonitor.md` §0.2。
- **想试红灯再动真仓？** 完整版 §3 有个构造红灯的练习。

---

完整版（带逐步练习 + 截图指引）：[MCP-DEMO-publicopinionmonitor.md](./MCP-DEMO-publicopinionmonitor.md)  
任意新项目通用教程（功能全景 + 报告解读）：[TUTORIAL-new-project.md](./TUTORIAL-new-project.md)
