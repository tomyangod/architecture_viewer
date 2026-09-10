# W15-07 零文档新手全流程

**日期**: 2026-09-09  
**协议**: 不看文档，只靠 MCP 返回的 `message` / `error` / `nextStep` 走完一次 session 循环  
**证据**: `node --test --test-timeout 120000 test/beginner-flow.test.js`（3/3 通过）

## 关键路径（8 步）

| # | 动作 | 期望引导 | 结果 |
|---|---|---|---|
| 0 | 误调 `av_session_report`（无基线） | `NO_BASELINE` + nextStep 指向 `av_session_start` | ✅ |
| 1 | `av_session_start` 拍照 | message 告诉去改代码，并提到 changes/report | ✅ |
| 2 | 改代码（storage → controller 跨层） | — | ✅ |
| 3 | `av_session_changes` | 有变更时引导 `av_session_report` | ✅ |
| 4 | `av_session_report` 红灯 | nextStep 含修复 + 复查 report + 刷新 start | ✅ |
| 5 | 去掉跨层 import | — | ✅ |
| 6 | 再调 report 复查 | 非 HIGH；nextStep 引导 `av_session_start` | ✅ |
| 7 | 二次 start 刷新基线 | 旧报告清除；再 report 无架构变更 | ✅ |

成功率：**8/8 = 100%**（门槛 ≥ 80%）。

## 与 W15-08 的分工

- **W15-07**：关键路径自解释（工具返回必须形成闭环，不依赖文档）。
- **W15-08**：安装 + 一次验收的体验/NPS 盲测（见 `pm/reports/W15-08-blind-test.md`）。

本项用「零文档 Agent」跑通 MCP 循环，作为可回归的门禁；真人外部盲测记录在 W15-08。

## 未覆盖

- 真人坐在旁边不看文档的现场观察（W16 小范围分发再补）
- VS Code 扩展状态栏路径
