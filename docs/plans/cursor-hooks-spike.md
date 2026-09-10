# Cursor Hooks Spike · W23-02

> 日期：2026-09-10  
> 目的：在写正式 `av_guard` / setup 写 hooks 之前，弄清 Cursor 对 `sessionStart` / `stop` 的真实契约，避免按 Sigrid 文档想当然。  
> 证据来源：[Cursor Hooks 官方文档](https://cursor.com/docs/hooks.md)、社区 bug（sessionStart `additional_context` 丢失）、第三方 stdin 实录、本仓 dry-run 脚本。

## 1. 结论先行（给 W23-04 的决策）

| 问题 | 结论 |
|------|------|
| P0 主强制该挂哪？ | **`stop`**（Agent 宣称完成时跑结构验收） |
| `sessionStart` 能否保证「改前拍照」？ | **不能当硬保证**：官方写明 fire-and-forget；Agent 循环不等它；**不依赖** `additional_context`（存在已知丢失 bug） |
| 绿灯能否 `followup_message`？ | **绝对不能**。非空 `followup_message` 会自动当成下一条用户消息 → 死循环。绿灯 stdout 必须是 `{}` |
| 红灯 followup 如何限速？ | `loop_limit: 1`（hooks.json）+ 脚本内 `loop_count >= 1 → {}` + 仅 `status === "completed"` 才考虑 followup |
| Cloud Agent？ | **`stop` 支持；`sessionStart` 不支持**。主路径必须 stop 中心，不能依赖 sessionStart |
| setup 写哪？ | **项目级** `.cursor/hooks.json`（Cloud 能读）；不要只写 `~/.cursor/hooks.json` |
| 本 spike 是否依赖 IDE 手测？ | 契约与限速逻辑可用 stdin dry-run 验证；IDE Hooks 面板手测列为可选加强项 |

**W23-04 落地（2026-09-10，多宿主）：**

1. **通用核**：MCP `av_guard`（ensure + verdict）+ CLI `session guard --adapter …`
2. **Cursor**：`setup --project` → `.cursor/hooks.json` stop → `--adapter cursor`（`followup_message` / `{}`）
3. **Claude Code**：`.claude/settings.json` Stop → `--adapter claude`（exit 2 + `decision: block`）
4. **DeepSeek Harness / 其他**：MCP + `AGENTS.md` / `.av/AGENT-GATE.md`（无原生 stop 时靠规则调 `av_guard`）
5. **生产 `setup --project` 不再写** `sessionStart`（与本 spike 一致：不依赖 `additional_context`）。`templates/cursor-hooks.example.json` 仍保留可选 `sessionStart`（仅 `env`），供 spike / 手测对照。

## 2. 官方契约摘要

### 2.1 `sessionStart`

- **何时**：新 composer 会话创建。  
- **性质**：fire-and-forget；Agent 循环不阻塞、不等待。  
- **stdin（文档）**：`session_id`、`is_background_agent`、`composer_mode`（agent|ask|edit）。  
- **stdout**：`env`（会话级，后续 hook 可见）、`additional_context`（应注入初始 system context）。  
- **已知坑**：论坛与 SDK 反馈 `additional_context` 可能被丢掉（官方确认 timing bug）；`env` 路径相对正常。  
- **Cloud**：**不运行** `sessionStart`（只读探索阶段 hook 未加载，真跑也太晚）。

### 2.2 `stop`

- **何时**：Agent loop 结束。  
- **stdin（文档 + 实录）**：至少 `status`（`completed`|`aborted`|`error`）、`loop_count`（从 0 起）；常见还有 `conversation_id`、`workspace_roots`、`transcript_path`、`hook_event_name` 等。  
- **stdout**：可选 `followup_message`；非空则自动提交为下一条用户消息。  
- **限速**：默认每脚本最多 5 次 auto follow-up；可用 `loop_limit` 覆盖；`null` 表示不封顶（AV **不要**用 null）。  
- **Cloud**：**支持**。

### 2.3 其他与 AV 相关但非本 spike 主路径

| 事件 | 对 AV 的用途 | 为何不主用 |
|------|--------------|------------|
| `postToolUse` | 在 Agent **已经**调了 report 后注入补充上下文 | 不能强迫 Agent 先调 report |
| `beforeMCPExecution` | 可 deny/ask 某 MCP | 挡得住乱调，逼不出验收 |
| `afterFileEdit` | 改文件后预热图缓存 | 太频；全仓扫描会拖死 |

## 3. 对 Architecture Viewer 的威胁模型

```
Agent 说「做完了」
        │
        ▼
   stop hook 触发
        │
        ├─ status != completed → {}（用户中止 / 错误，不打扰）
        ├─ loop_count >= 1     → {}（本轮已 followup 过，防死循环）
        ├─ 无基线/无 git       → 可选 followup「请先建立基线」或静默（P0 建议：有基线才验）
        ├─ session report 绿灯 → {}
        └─ HIGH 红灯           → followup_message = verdict 三行 + 修法提示
```

**严禁**：

- 绿灯打印 `followup_message: "通过了"`（仍会开新一轮 Agent）。  
- 每次 stop 无条件 followup。  
- `loop_limit: null`。  
- 把「必须打开 HTML」写进 followup。

## 4. Dry-run 验证（本仓已做）

脚本：

- `templates/cursor-hooks.example.json` — 可复制的 hooks.json  
- `templates/cursor-hooks/av-session-start.js` — sessionStart 示例  
- `templates/cursor-hooks/av-stop.js` — stop 示例（含限速 + 假报告 / 真 CLI）  
- `test/cursor-hooks-spike.test.js` — 不启 IDE，纯 stdin/stdout 契约测试  

验收命令：

```bash
node --test test/cursor-hooks-spike.test.js
```

覆盖：

1. 绿灯 / 无报告 → stdout `{}`  
2. HIGH + `loop_count=0` + `status=completed` → 含 `followup_message` 且含 verdict 关键词  
3. HIGH + `loop_count=1` → `{}`（限速）  
4. `status=aborted` → `{}`  
5. sessionStart stdout 含 `env`，且不把业务逻辑绑死在 `additional_context`

## 5. IDE 手测清单（可选，W23-04 前做一次即可）

1. 把 `templates/cursor-hooks.example.json` 拷到业务仓 `.cursor/hooks.json`，脚本拷到 `.cursor/hooks/`。  
2. Cursor → Hooks 输出通道确认加载。  
3. 新开 Agent 对话：看 sessionStart 是否出现在 Hooks 日志（不要求模型复述 additional_context）。  
4. 故意制造跨层 import → Agent 改完停下：应自动跟进一条含红灯 verdict 的用户消息。  
5. Agent 修绿再停：Hooks 日志里 stop 返回 `{}`，无第二轮自动消息。

## 6. 对后续任务的明确答复

> 「明确 P0 是否依赖 stop followup，或改走 Agent 规则 + pre-commit 兜底」

**依赖 `stop` + `followup_message` 作为主强制**（本地与 Cloud 都通）。  
Agent 规则 = 默契层；pre-commit = 提交兜底。  
**不**把 P0 成败绑在 `sessionStart.additional_context` 上。

若某 Cursor 版本 followup 异常：降级为 stop 只写 `.av/last-verdict.txt` + 状态栏/扩展读取（P1），本地仍靠 pre-commit 挡 HIGH。

## 7. 开放风险（带入 W23-03/04）

1. stop 上全量扫 251 files 可能慢 → 依赖 W23-03 HEAD 缓存 / 增量。spike 脚本可用 `AV_HOOK_TIMEOUT_MS` 超时后只 followup「请手动 session report」。  
2. 脏工作区「这一句需求 vs 未提交大 diff」→ W23-03 verdict 标明对照点。  
3. Windows 路径与 `node` PATH → setup 应用 `process.execPath` 调脚本，避免依赖用户 shell 的 `node`。
