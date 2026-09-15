# 第二轮软触达（2026-09-12）

> 以下为当日发出原文。**新消息改钉 `0.12.2-rc.6`**，见 [outreach-kit.md](outreach-kit.md)。

招募：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T
掘金：https://juejin.cn/post/7684463933702029322

## 掘金沸点（短帖，提高曝光）

AI 改完几百行，单测绿了，但 Controller 有没有偷偷直连 DB？人工扫 diff 最累的是这种「结构问题」。

开源本地工具 Architecture Viewer：对照 git HEAD 看增量跨层依赖，exit 0/1 红绿灯。钉 `arch-viewer@0.12.2-rc.2`。

招 2 个非关联 Python/TS 团队本地试用（不交私码）：Issue IKF74T
https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T

## 软评 1｜得物 AI CR 流水线
https://juejin.cn/post/7624969096745779235

你们把 AI CR 接到流水线很扎实。我们在补另一块：MR 前本地就能抓「跨层依赖/分层穿透」（单测和普通 CR 常漏）。开源 CLI，纯本地。试点招 2 队：Issue IKF74T

## 软评 2｜多 Agent Worktree 大重构
https://juejin.cn/post/7659304723573653556

并行 Agent 最容易风格/边界漂移。Rules 能统一写法，结构门可以拦「不该出现的跨层 import」。本地 `arch-viewer@0.12.2-rc.2`，改完看灯再 merge。招试点：IKF74T

## 软评 3｜别让 Agent 直接改主分支
https://juejin.cn/post/7658283231868059691

同意先隔离再 review。结构层面我们也在验一个本地增量门：对照 HEAD 看有没有 layer-skip。不替代流程，是停手后的 1 秒检查。Issue IKF74T

## 说明
V2EX 高共鸣帖（不能靠 AI 治架构病 / AI 屎山 / 重构维护）暂不评论——当前无 V2EX 号。有号后优先回 https://www.v2ex.com/t/1177422 与 https://www.v2ex.com/t/1215936
