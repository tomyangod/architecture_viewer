# W15 B+ 验收 1/8 ~ 7/8

**日期**: 2026-09-09  
**范围**: W15-01 ~ W15-07（W15-08 已完成，见盲测报告）

## 总表

| 卡 | 验收 | 命令 | 结果 |
|---|---|---|---|
| W15-01 | 主仓 / worktree / 子目录路径不拍错 | `node --test test/session-paths.test.js` | 7/7 |
| W15-02 | Python 3 种 + JS 2 种结构改动，图与 findings 对齐 | `node --test test/visual-acceptance.test.js` | 6/6 |
| W15-03 | 5 合成 + 2 真实仓四口径 | `node --test test/four-way-consistency.test.js` | 12/12 |
| W15-04 | 刷新基线后旧报告不误读 | `node --test test/stale-report.test.js` | 8/8 |
| W15-05 | 绿灯不说「无变化」 | `node --test test/green-light-copy.test.js` | 7/7 |
| W15-06 | HIGH 三端一致 | `node --test test/high-finding-three-way.test.js` | 2/2 |
| W15-07 | 零文档 MCP 循环不迷路 | `node --test --test-timeout 120000 test/beginner-flow.test.js` | 3/3 |

## 本轮产品修补

1. **路径**：`samePath` / `isInside` 按祖先 realpath，避免 macOS `/var` 与 `/private/var` 误报 `PATH_MISMATCH`；worktree 明确警告「不是主仓，基线写在 worktree `.av/`」。
2. **四口径**：`buildReportData` 顶栏 `summary.violations` 改为图上 `violation` 边数（findings ∪ diff.violations），不再只信 `diff.summary.violations`。
3. **真实仓**：beginner-demo v1→v2、tutorial-demo routes 直连 database 纳入四口径回归。

## 证据要点

- **W15-01**：主仓无 worktree 警告；worktree 警告且基线不写主仓；子目录警告「不是 Git 根」；在 worktree 里对主仓 `session start` 中止、不写基线。
- **W15-02**：Python 跨层 exit 1、删边顶栏=图 removed、神文件 `helpers.py`；JS 跨层 + 删边。
- **W15-03**：合成 5 场景 + 两真实仓；归属边/外部边不进图。
- **W15-04**：start 清 `session-report*` / `archify-*`；删失败覆写「报告已过期」；HTML 有「点时快照」。
- **W15-05**：改函数体/注释时写「未检测到架构结构变化」+「检测到源码内容变化」；禁止裸「无变化」。
- **W15-06**：同一跨层改动 CLI exit 1 / MCP `riskLevel=high` / HTML 红灯，标题与 rule 一致。
- **W15-07**：见 `W15-07-beginner-flow.md`，8 步成功率 100%。
