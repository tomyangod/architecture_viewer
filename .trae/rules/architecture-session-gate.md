---
description: AI 编码会话完成后必须过架构验收门（session report → 用户确认 → 刷新基线）
globs: "**/*.{js,ts,jsx,tsx,py,go,java,vue,svelte}"
alwaysApply: true
---

# 架构验收门（每次 AI 编码会话收尾必做）

本仓库内置架构变更验收工具（Architecture Viewer，零依赖离线运行）。完成代码改动后、宣布任务完成前，必须执行：

1. **跑报告**：`npm run arch:report`（等价 `node lib/cli.js session report . --open`，自动打开 HTML 前后对比图）。
2. **高信号汇总**：用中文简短汇报——新增/删除/修改/重命名实体数量、外部依赖变化、风险 findings（🔴高 / 🟠中 / 🔵低）。归属关系边和未变更项默认折叠，不用念；用户要求时加 `--all`。
3. **门规确认**：🔴 高风险发现（跨层违规、类型删除、层级穿透、新外部依赖）必须逐条说明并等待用户处置，不得忽略；报告退出码为 1。
4. **刷新基线**：只有用户**明确确认**变更符合预期后，才运行 `npm run arch:baseline`（`session start`）刷新基线。禁止 AI 自行刷新基线。
5. **零变更场景**：报告 NONE / +0-0~0 时一句话带过即可，不打扰。

约定与边界：

- 基线文件 `.av/graph-baseline.json` 随代码提交（团队共享基线）；`.av/session-report.*` 与 `.av/habit-gate-log.md` 本地生成，不入库。
- 工具自动跳过 `test/`、`eval/`、`examples/`、`docs/`、压缩文件和 `.gitignore` 忽略项，不要手动调整跳过规则来"消除"变更。
- 报告只反映代码结构变更（文件/类型/函数/依赖边）；重命名归并、文件内新增函数检测已内置，若把重命名误报成删+增，按工具缺陷处理并反馈。
- 初次克隆或基线缺失时，先 `npm run arch:baseline` 初始化。
