# 用 AI 自动生成架构图，还能在 PR 里抓漂移

> **Architecture Viewer 实战文**（2026-09）  
> 目标读者：用 Cursor / Claude / Copilot 写业务代码的后端与全栈；合入前想看清「架构到底变了什么」的人。

## 发布链接（三平台）

| 平台 | 链接 | 状态 |
|------|------|------|
| **GitHub / Gitee README** | [仓库 README](https://gitee.com/heyangyan/architecture_viewer) · [本文源文件](https://gitee.com/heyangyan/architecture_viewer/blob/main/docs/demos/blog/2026-09-ai-architecture-drift.md) · [GitHub 镜像](https://github.com/heyangyan/architecture_viewer) | 已入库，随仓库公开 |
| **掘金** | 《用 AI 自动生成架构图，还能在 PR 里抓漂移》（标题与正文以本文为准，发布后把文章 URL 回填此处） | 草稿就绪，待发帖回填 |
| **知乎** | 同题专栏/回答（发布后把文章 URL 回填此处） | 草稿就绪，待发帖回填 |

> 外发时请同步更新本表 URL。Demo 素材：[60 秒分镜脚本](../demo-script.md) · [demo.gif](../demo.gif)（成片见 W05-03）。

---

## 1. 痛点：AI 说「重构完成」，你敢直接合吗？

一次 Cursor 会话两小时，diff 可能几百行、几十个文件。逻辑 review 还能做，**架构层面**往往靠肉眼记忆：

- 删了哪个被五个模块引用的类型？
- controller 是不是直连了 storage / repository？
- 顺手装的第三方包谁批准的？
- 这次改动会波及谁——还是只看得到「绿勾测试」？

代码审查抓的是语句对不对；**架构漂移**抓的是结构有没有被改坏。AI 编码把改动速度拉高一个数量级之后，合入前缺的不是更多注释，而是一张**可重复、可进 CI 的结构对比**。

Architecture Viewer 做的事很简单：

1. **改之前拍照**（会话基线）  
2. **改之后对比**（变更图谱 + 风险分级 + 影响面）  
3. **坏图进不了主干**（漂移检测 / PR 评论）

它不依赖 LLM 也能出图与出报告（tree-sitter 静态解析）；精修、托管评论是可选 Pro 层。Community 能力按 [COMMERCIAL.md](../../commercial/COMMERCIAL.md) **永不电检许可证**。

![60 秒 Demo](../demo.gif)

---

## 2. 60 秒上手：三步会话验收门

环境：Node.js ≥ 18。免安装直接用：

```bash
# ① 让 AI（或你自己）改代码之前：记录架构基线
npx arch-viewer session start .

# ……改代码……

# ② 会话结束：Before / Delta / After + 风险分级
npx arch-viewer session report . --open

# ③ 确认变更符合预期后：刷新基线，开始下一轮
npx arch-viewer session start .
```

报告会告诉你：实体新增 / 删除 / 修改 / 重命名、外部依赖变化、🔴 跨层违规与层级穿透、类型删除按下游数升降级、**反向依赖影响面**（谁会被波及）。高风险时退出码为 1，可以直接卡进 AI 工作流规则。

更省事的一键接入（自动写 Cursor / Claude / DeepSeek Harness 配置）：

```bash
npx arch-viewer setup
```

装好以后，你只需要对 AI 说人话：「改代码前先拍照，改完检查有没有改坏。」

支持语言：JavaScript / TypeScript（含 Vue、Svelte）、Python、Go、Java。  
四端入口：**CLI 会话门 / MCP / 本机网页 / PR 评论**（详见仓库 [README](../../../README.md)）。

新手若被术语卡住，先看 [小白图文攻略](../../guides/beginner-guide/index.html) 或 [Quickstart 术语速查](../../guides/quickstart.md#术语速查)。

---

## 3. 漂移检测演示：坏图必须红灯

「自动生成架构图」只是诱饵；**漂移红灯**才是合入门禁。

仓库自带故意写坏的夹具 `eval/demo-drift`：未声明的 Rel + 未替换的模板占位。在本仓库根目录执行：

```bash
npx arch-viewer check eval/demo-drift --filled
# 期望：非零退出；错误里能看到 NOT DECLARED / placeholder
```

这就是 CI 路径的最小证明：坏图过不了校验。

把同样的检查挂到 GitHub Actions，每个 PR 自动贴架构影响面评论（重复 push 只更新原评论，不刷屏）：

```yaml
# .github/workflows/architecture-diff.yml（摘要）
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: git worktree add --detach /tmp/av-base "${{ github.event.pull_request.base.sha }}"
- env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npx --yes arch-viewer@latest pr-comment /tmp/av-base . --post
```

评论内容：变更计数、新增 / 移除第三方依赖、风险发现、影响面 Top N。本仓 dogfood 工作流见仓库 `.github/workflows/architecture-diff.yml`。

若你更关心「出六视图交付物」而不是会话门，也可以：

```bash
npx arch-viewer init .
npx arch-viewer generate .
npx arch-viewer check . --filled --drift --repo .
```

Generate 会扫描仓库写出 C4 / 分层 / 类图 / 运维等图源，并做 Rel 协议校验；失败时 CLI 会给出**可操作的修复提示**（缺声明就提示先加 Container/System）。

---

## 4. 实战小例子：beginner-demo 走一遍红灯

仓库自带 `examples/beginner-demo`：v1 是干净分层，v2 补丁模拟「AI 顺手重构」引入坏味道。本地可这样演示（**先复制，勿直接改 examples**）：

```bash
rm -rf /tmp/av-demo
cp -R examples/beginner-demo/v1 /tmp/av-demo
cd /tmp/av-demo
npx arch-viewer session start .
# 把 v2-ai-patch 里的文件拷进对应目录（见 examples/beginner-demo/README.md）
npx arch-viewer session report . --open
```

你应能在报告里看到结构差与风险项；HTML 里有 **Before / Delta / After** 三栏，方便截图进 PR 或周会。完整分镜与口播见 [docs/demo-script.md](../demo-script.md)。

评测侧：`eval/repos.json` 覆盖 Python/Node 真实仓 + 仓内前端（Vue）与 Go 夹具，回归命令：

```bash
npx arch-viewer eval
# 报告：eval/REPORT.md
```

---

## 5. 定价与链接（Community 永不付费墙）

| 档位 | 价格 | 你得到什么 |
|------|------|------------|
| **Community** | ¥0 | CLI / MCP / 本机网页；Init、Generate、session、check；Actions 漂移模板；自托管分享 |
| **Pro** | **¥29 / 月** | 账号 + 7 天试用；本机文件夹检查 + 可选企业微信；托管 PR 漂移评论 |
| **Team** | **¥99 / 人 / 月**（验证期人工申请） | 共享图库、组织规范、CI 门禁托管；私有化另议 |

一句话：**出图是诱饵，漂移红灯才是订阅理由。** Community 不会把「单次 Generate 次数」做成付费墙。细节见 [COMMERCIAL.md](../../commercial/COMMERCIAL.md)。

账号（可选）：

```bash
npx arch-viewer auth login you@example.com
npx arch-viewer auth whoami
```

### 链接清单

- 仓库（主站 Gitee）：https://gitee.com/heyangyan/architecture_viewer  
- GitHub 镜像：https://github.com/heyangyan/architecture_viewer  
- npm：`npm i -g arch-viewer` / `npx arch-viewer setup`  
- 商业边界：`docs/commercial/COMMERCIAL.md`  
- 本地 Pro 说明：`docs/commercial/PRO-LOCAL.md`  
- 本文源文件：`docs/demos/blog/2026-09-ai-architecture-drift.md`

遥测默认关闭；需要时才设 `ARCH_TELEMETRY=1`，且不采集路径与源码（见 README 隐私段）。

---

## 6. 常见问题

**一定要 LLM 吗？**  
不必。骨架 Generate 与 session 报告是确定性静态分析。`--refine` / 云端精修才需要 Key 或 Pro 通路。

**和画板类工具有什么差别？**  
画板交付「一张好看的图」；本工具交付「合入前的结构差 + 可进 CI 的红灯」。图可以给人看，门禁给流程看。

**误报怎么办？**  
用 `.av/layers.json` 锁定分层；高信号优先折叠归属边；欢迎用真实仓开 Issue，附 `session-report` 摘要（勿贴密钥）。

**VS Code 扩展呢？**  
当前主推 CLI / MCP / 网页；扩展相关任务暂缓，不挡 Community 验收。

---

## 7. 下一步

1. 对本仓库或你的业务仓跑一遍 `session start` → 改一点代码 → `session report`。  
2. 把 `templates/architecture-check.yml` 或上文 PR 工作流拷进团队仓。  
3. 若愿意当种子用户：看 `pm/growth/seed-users.md` 话术，或直接提 Issue 反馈。  
4. 录一段 60 秒屏：按 [demo-script.md](../demo-script.md) 走，替换 README 首屏 GIF。

欢迎 Star、Fork、拍砖。架构审查不该只靠「我感觉没坏」。

---

*作者：heyangyan · License：Apache-2.0 · 文中命令以仓库当前主分支为准。*
