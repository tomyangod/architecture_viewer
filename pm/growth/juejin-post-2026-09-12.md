# 掘金草稿（2026-09-12）

> 用途：用户账号发布。定位增量架构门试点招募，非 Star 竞赛。

## 标题

AI 改完 500 行，如何用 1 秒看清有没有把 Controller 直连 DB？

## 标签建议

前端 / 后端 / Python / TypeScript / AI / 架构 / 开源

## 正文

用 Cursor / Copilot 改完一大段代码，单测经常是绿的，但 review 最累的往往不是语法，而是：

> 它有没有悄悄把 **Controller 和 DB 直连**？有没有跨层 import、架构漂移？

这类问题人工扫 diff 容易漏，常规单元测试也查不出来。

### 我们在验什么

开源工具 **Architecture Viewer**（Apache-2.0）定位是：

**AI 改码后的增量架构风险验收**——对照 git HEAD，检查新增跨层依赖和结构变化；纯本地运行，不上传代码。

它不替代测试，也不替代业务逻辑审查。**绿灯 ≠ 代码正确**，只表示这次增量没有触发你配置的结构门。

极简闭环：

说话 → 看灯（绿 / 红）→ commit 才接受新基线

CLI 退出码：`0` 通过；`1` 结构红灯（不是安装失败）。

### 30 秒试用（请钉死试点版本）

不要用可能落到旧版的 `latest`，请用：

```bash
npx --yes --package arch-viewer@0.12.2-rc.3 arch-viewer --version
npx --yes --package arch-viewer@0.12.2-rc.3 arch-viewer session report /绝对路径/to/repo --renderer builtin
```

源码与说明：https://gitee.com/heyangyan/architecture_viewer

试点招募 Issue：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T

### 在招 2 个非关联团队

优先：

- Python / JS / TS 仓库
- 日常用 AI 跨文件改码
- 有明确模块边界
- 最近有过「分层乱了 / review 变重」的具体经历

本地分析免费；不要求交私码或 PAT；每周约 15 分钟反馈；随时可退。托管服务另议，不混进本次免费试点。

有具体痛点的，欢迎到 Issue 评论，或私信说明：最近一次结构问题是什么、谁发现的、现有工具为何没拦住。只觉得架构图好看的，暂不当首批主样本。
