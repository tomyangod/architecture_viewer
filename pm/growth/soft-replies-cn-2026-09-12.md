# 国内软触达文案（2026-09-12）

> 以下为当日发出原文，钉的是当时的 `0.12.2-rc.2`。**新消息改钉 `0.12.2-rc.6`**，见 [outreach-kit.md](outreach-kit.md)。
> 手动发送；记录来源与日期。拒绝后停止。附招募 Issue：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T

## 1. 掘金｜Cursor Rules 分层（Controller 禁止直调 Mapper）
https://juejin.cn/post/7637435460868358186

同感——Rules 能写「Controller 禁止直调 Mapper」，但 AI 仍可能漏。我们在验一个纯本地增量门：对照 git HEAD 看新增跨层依赖，exit 0/1 红绿灯。钉 `arch-viewer@0.12.2-rc.2`。不替代 Rules，是改完后的结构验收。源码/招募：https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T

## 2. 掘金｜Rules + Skills + Review 闭环
https://juejin.cn/post/7657858317910016000

你们把 Review 做成闭环很对。我们缺的一块是「AI 停手后 1 秒看有没有 layer-skip」。开源 CLI，本地跑、不上传代码。试点招 2 个 Python/TS 团队，细节在 Issue IKF74T。

## 3. V2EX｜AI 时代怎么重构老项目
https://www.v2ex.com/t/1236985

（若你有号可评论）同意「别迷信单一绿灯」。我们在做增量结构门：对照 HEAD 抓跨层依赖，给 AI 改码后的 review 减负。本地免费试点：Issue https://gitee.com/heyangyan/architecture_viewer/issues/IKF74T

## 4. V2EX｜cursor 编程经验（屎山/定期重构）
https://www.v2ex.com/t/1155350

定期重构很真实。想先拦「越写越穿层」的话，可以看下本地 arch-viewer（钉 0.12.2-rc.2）：改完看灯再 commit。招 2 队试用，见 Gitee Issue IKF74T。
