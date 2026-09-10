# W15-08 盲测报告

**日期**: 2026-09-08  
**测试人**: AI 模拟（零背景开发者视角）  
**耗时**: ~25 分钟（模拟安装 + CLI 流程 + MCP 流程 + 痛点记录）  

## 测试协议

模拟一名不知道项目背景的开发者，仅凭 README、工具描述和错误消息引导，完成：
1. 安装（npm / npx）
2. CLI 一次 session 验收（beginner-demo 脚本）
3. MCP 一次 session 验收（6 个工具的自由探索）

## 测试路径

### 路径 A：CLI（beginner-demo.sh）

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | `bash scripts/beginner-demo.sh` | ✅ 一键跑通，4 步清晰 |
| 2 | 脚本输出基线信息 | ✅ "拍好了"消息清晰 |
| 3 | 脚本自动叠 AI 补丁 | ✅ 补丁说明清楚 |
| 4 | 脚本生成报告 | ✅ 红灯 HIGH 正确检出 |

**痛点**:
- 🟡 **worktree 警告噪音**: 脚本对 `/tmp/av-beginner-demo` 和当前 shell 目录不一致发出警告，新手会困惑"我是不是搞错了"。建议在 demo 脚本中静默此警告。
- 🟡 **Pro 试用推销**: 报告末尾出现"Pro 提示"段落，对盲测新手是噪音。建议在 demo 场景下静默。
- 🟡 **命令名不一致**: 脚本运行的是 `node lib/cli.js session start`，但返回消息里写的是 `arch-viewer session start`。新手可能不知道两者等价。

### 路径 B：MCP（AI Agent 视角）

| 步骤 | 操作 | 结果 | 修复前 | 修复后 |
|------|------|------|--------|--------|
| 1 | 误调 `av_session_report`（无基线）| ✅ 引导调 start | 无 nextStep | ✅ 有 nextStep |
| 2 | 误调 `av_session_changes`（无基线）| ✅ 引导调 start | 无 nextStep | ✅ 有 nextStep |
| 3 | 调 `av_session_start` | ✅ 拍照成功 | 无 nextStep | ✅ 有 nextStep |
| 4 | 调 `av_session_changes`（无变更）| ✅ 绿灯 | "结构没变"（W15-05 不合规）| ✅ 标准术语 |
| 5 | 改坏代码 → `av_session_changes` | ✅ 红灯引导 | 无 nextStep | ✅ 有 nextStep |
| 6 | 调 `av_session_report`（红灯）| ✅ 完整报告 | 已有 nextStep | 不变 |
| 7 | 修复 → `av_session_report`（绿灯）| ✅ 引导刷新 | 已有 nextStep | 不变 |

## 发现的痛点与修复

### 🔴 痛点 1：`nextStep` 字段不一致（HIGH）

**现象**: AI Agent 依赖结构化字段做决策。`av_session_report` 返回 `nextStep`，但 `av_session_start`、`av_session_changes`、所有 `NO_BASELINE` 错误都不返回 `nextStep`，引导只藏在 `message` 里。

**影响**: Agent 程序化检查 `nextStep` 时会在这些节点断路，被迫 parse 自然语言 message。

**修复**: 给所有 6 个工具的所有返回路径加上结构化 `nextStep` 字段：
- `toolSessionStart`: `nextStep: '让 AI 改代码。改完后调 av_session_changes 轻量检查，或直接调 av_session_report 看完整报告和红灯。'`
- `toolSessionReport` NO_BASELINE: `nextStep: '调 av_session_start 拍基线照片，然后开始改代码。'`
- `toolSessionChanges` NO_BASELINE: `nextStep: '调 av_session_start 拍基线照片，然后开始改代码。'`
- `toolSessionChanges` analyzing: `nextStep: '等 20 秒让防抖完成，然后调 av_session_report 看完整报告。'`
- `toolSessionChanges` ready: `nextStep` 根据 hasChanges 动态切换
- `toolSessionChanges` idle: `nextStep: '改完代码后调 av_session_changes 检查，或直接调 av_session_report 看报告。'`
- `toolSessionChanges` no-baseline fallback: `nextStep: '调 av_session_start 拍基线照片。'`

### 🟠 痛点 2：`changes` 返回 "结构没变"（MEDIUM）

**现象**: `av_session_changes` 无变更时返回 "没有检测到架构变更，结构没变。"

**影响**: 违反 W15-05 标准术语要求——"结构没变"暗示代码完全没动，而实际上源代码内容可能已修改（只是类型/import/分层没变）。

**修复**: 统一为 "未检测到架构结构变化（源代码内容可能已修改）。"

### 🟡 痛点 3：CLI 路径噪音（LOW，未修复）

**现象**: beginner-demo 脚本输出 worktree 警告 + Pro 试用推销。

**影响**: 不影响功能，但降低新手 demo 体验的"干净度"。

**建议**: 后续在 demo 脚本中通过环境变量静默这两类噪音。

## 修复验证

新增测试 `nextStep 字段在所有工具返回中一致出现（盲测一致性）`，覆盖：
1. `NO_BASELINE` 错误（report + changes）的 nextStep
2. `start` 成功的 nextStep
3. `changes` 无变更状态的 nextStep
4. `report` 绿灯的 nextStep
5. 改坏代码后 `changes` + `report` 的 nextStep

## 净推荐值（NPS）

| 维度 | 评分（0-10）| 说明 |
|------|-------------|------|
| 安装便捷度 | 8 | `npx arch-viewer setup` 一行接入，但需要 Node.js ≥ 18 |
| CLI 流程清晰度 | 8 | beginner-demo 脚本很好，但有噪音 |
| MCP 工具自解释性 | 9 | 工具描述清晰，"拍照/红灯/绿灯"比喻友好 |
| 错误引导完整性 | 9 | 修复后所有路径都有结构化 nextStep |
| 报告可读性 | 9 | 风险等级、finding 详情、影响面都清晰 |
| 30 分钟可完成度 | 9 | beginner-demo 5 分钟可跑完 |

**综合 NPS: 8/10**（推荐使用，修复后体验显著提升）

## 未覆盖项

- 真实人类用户盲测（需外部开发者参与）
- 不同语言项目（Java/Go）的 CLI 流程
- VS Code 扩展流程
- Web 版流程
- PR 自动评论流程

## 下一步

- [ ] 邀请 1 名真实外部开发者执行同一协议（W16-01 小范围分发的前置）
- [ ] 在 demo 脚本中静默 worktree 警告 + Pro 推销
- [ ] 更新 tasks.json W15-08 状态
