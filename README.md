# Architecture Viewer

**AI 写完代码后，自动看清架构变了什么。**

会话基线 → 变更图谱 → 影响面分析：CLI / MCP / 网页 / PR 评论四端可用。
免费开源（Apache-2.0），零配置、秒级出图，不依赖 LLM。

![demo](docs/demo.gif)

> **English**: [README.en.md](README.en.md)

> **新手入门**：如果你不太懂技术术语，先看 [小白超详细攻略](docs/beginner-guide/index.html)（图文版）
> 或 [会话验收指南](docs/SESSION-GUIDE.md)（大白话版，无技术术语）。
>
> 痛点：AI 编码会话一次改动几十个文件，**合入前没人说得清架构到底变了什么**——
> 删了哪个被广泛依赖的类型？有没有跨层调用？新引入了哪些第三方包？谁会被波及？
> Architecture Viewer 在会话结束时给出 Before/After 架构对比和风险分级，红灯只亮在刀刃上。

---

## 四种用法

### 1. CLI 会话验收门（AI 编码会话收尾）

```bash
npx arch-viewer session start        # ① 让 AI 改代码前：记录架构基线
# ……AI 写代码 / 你自己写代码……
npx arch-viewer session report       # ② 会话结束：Before/After 对比 + 风险分级
npx arch-viewer session start        # ③ 确认变更符合预期：刷新基线，开始下一轮
```

报告输出：实体新增/删除/修改/重命名计数、外部依赖变化、风险发现
（🔴 跨层违规 / 类型删除 / 层级穿透 / 新外部依赖）、**反向依赖影响面**（谁会被波及），
并生成可分享的 HTML 前后对比图（`.av/session-report.html`）。
高风险时退出码为 1，可直接卡进 AI 编码工作流（规则示例见 `.trae/rules/`）。

### 2. 一键接入 AI 工具（Cursor / Claude / DeepSeek）

```bash
npx arch-viewer setup          # 自动装好、自动打开图文引导页，之后只需对 AI 说人话
```

自动检测已安装的 AI 编程工具（Cursor、Claude、DeepSeek Harness），把架构检查规则
写进它们的配置目录。之后对 AI 说「改代码前先拍照，改完检查有没有改坏」即可。

### 3. PR 自动评论（GitHub Actions）

每个 PR 自动贴一条架构影响面评论；同一 PR 重复 push 只更新原评论，不刷屏：

```yaml
# .github/workflows/architecture-diff.yml
name: Architecture Diff
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  impact-comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Checkout PR base
        run: git worktree add --detach /tmp/av-base "${{ github.event.pull_request.base.sha }}"
      - name: Post architecture impact comment
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx --yes arch-viewer@latest pr-comment /tmp/av-base . --post
```

评论内容：变更计数表、新增/移除第三方依赖清单、🔴🟠 风险发现、影响面 Top N（反向依赖）。
本仓 dogfood 工作流见 [.github/workflows/architecture-diff.yml](.github/workflows/architecture-diff.yml)。

---

## Install

```bash
npm i -g arch-viewer        # CLI 全局安装
# 或免安装直接用：npx arch-viewer <command>
```

要求 Node.js ≥ 18。支持语言：JavaScript / TypeScript（含 Vue、Svelte）、Python、Go、Java
（tree-sitter 解析，内置六平台 prebuild，安装无需编译）。

## Quick Start（30 秒）

**最省事的方式（推荐小白）**——一条命令自动接入 Cursor / Claude，不用编辑任何配置文件：

```bash
npx arch-viewer setup          # 自动装好、自动打开图文引导页，之后只需对 AI 说人话
```

**手动方式**：

```bash
npx arch-viewer session start .        # ① 改代码之前：拍"改之前"的结构照片
echo '// 随便改点代码：新增/删除一个类或改个 import'
npx arch-viewer session report .       # ② 改完后：对比前后照片，看有没有改坏（加 --open 浏览器看对比图）
```

> **不懂技术术语？** 拍照片 = 记录改之前的结构。对比照片 = 看 AI 改了什么、有没有"串门"（跨层引用）。红灯 = 可能改坏了，绿灯 = 没问题。详见 [术语对照表](docs/SESSION-GUIDE.md#术语对照表遇到看不懂的词查这里)。

其他常用命令：

```bash
arch-viewer extract <repo> --out graph.json      # 导出代码结构图谱
arch-viewer diff <base-dir> <head-dir> --json    # 结构 diff（JSON）
arch-viewer impact <base-dir> <head-dir>         # 影响面文本报告
arch-viewer pr-comment <base-dir> <head-dir>     # PR 评论 Markdown（--post 直接发）
arch-viewer workspace ...                         # 多仓基线管理
arch-viewer auth login [email]                    # 邮箱验证码登录（Pro 账号）
arch-viewer auth whoami                           # 查看当前登录邮箱与 Pro 状态
```

---

## 风险分级与影响面怎么算

- **风险发现**（`lib/risk-rules.js`）：跨层依赖违规、层级穿透（controller 直连 storage）、
  类型删除（按下游数量升降级）、新增外部依赖、高扇出变更、孤儿新实体。
- **影响面**（`lib/impact.js`）：从被改实体出发，沿 import/extends/implements/calls 等
  wiring 边**反向 BFS**（base 与 head 反向边取并集，穿透被改实体集群），
  报告集群边界之外的直接/间接受害者。归属关系边（declared-in）不参与。

## 分层识别：零配置，也可锁定

跨层违规检测依赖「每个文件属于哪一层」。0.9 起分层由四个信号交叉推断，
不需要手写配置：

1. **`.av/layers.json` 用户配置**（最高优先）——`{ "目录名": "分层名" }`；
2. **import 框架语义**——import 了 sqlalchemy/gorm/`JpaRepository` → storage，
   flask/express/gin/`@RestController` → controller，`@Entity` → domain 等；
3. **目录名/文件名约定**——`services/`、`*Controller.java`、`data_collection/` 等；
4. **结构位置兜底**——被很多模块依赖且自己不依赖别人 → domain，只出不进 → controller。

每次 `session start` / `extract` 后，推断结果会写入 `.av/layers.suggested.json`
（按目录聚合，含置信度和判定依据；import 信号与目录名冲突的文件会单列）。
审阅没问题就不用管；想锁定或纠正，复制为 `.av/layers.json` 即可——它永远优先、
不会被覆盖。实测 246 文件的 Python 爬虫仓分层覆盖率从 57% 提升到 92%。

## 经典能力：PR 漂移红灯

图与代码不一致时 CI 失败，坏图进不了主干：

```bash
npx arch-viewer init .
npx arch-viewer generate .
npx arch-viewer check architecture_viewer --filled --drift --repo .   # 漂移即 exit ≠ 0
```

CI 模板：[.github/workflows/architecture-check.yml](.github/workflows/architecture-check.yml)。

## 网页版（分享 / 评审）

```bash
npm run web    # http://127.0.0.1:3847 — 粘贴仓库 URL 生成六视图，/p/<id> 内联分享
```

新叙事落地页：[landing-new.html](landing-new.html)（`open landing-new.html` 直接浏览）。
小白超详细攻略（含 AI 会话验收 Demo）：[docs/beginner-guide/index.html](docs/beginner-guide/index.html)。

---

## 目录

```
├── lib/                              # 扫描 / diff / 影响面 / 风险规则 / 报告 / 遥测（CLI · MCP · Web 共用）
│   └── pro/                          # Pro 核心：账号 / 权益 / 存储 / CLI auth client
├── src/extension*.js                 # VS Code 扩展：会话命令 + 状态栏 + Webview（暂缓）
├── scripts/build-vsix.js             # 扩展打包 vsce（暂缓）
├── scripts/pr-comment.js             # CI 评论入口
├── web/                              # 落地页 + API + /p/<id> 分享页 + Pro 路由
├── .github/workflows/                # architecture-check（漂移红灯）+ architecture-diff（PR 评论）
├── templates/                        # 可复制的套件与 CI 模板
└── eval/                             # 多语言解析夹具与评测
```

## Pro 账号

```bash
arch-viewer auth login you@example.com    # 输入邮箱，收到 6 位验证码，输入后登录
arch-viewer auth whoami                  # 查看当前登录邮箱与 Pro 状态
arch-viewer auth logout                  # 退出登录
```

首次登录自动建档为 7 天 Pro 试用。token 存于 `~/.config/arch-viewer/auth.json`（权限 0600），
重启终端仍登录。详见 [lib/pro/README.md](lib/pro/README.md)。

## 隐私与遥测

CLI 遥测**默认关闭**，企业友好。开启方式：

```bash
export ARCH_TELEMETRY=1    # 开启
# 或设 DO_NOT_TRACK=1 永久关闭（优先级最高）
```

开启后仅记录：事件名（CLI 命令名）、耗时（毫秒）、退出码、CLI 版本、操作系统类型。
**不记录**：文件路径、代码内容、仓库名/URL、用户邮箱。数据落本地
`~/.config/arch-viewer/telemetry.log`（JSONL），可随时查看或删除。

## 定价摘要

| 档位 | 价格 | 要点 |
|------|------|------|
| Community | ¥0 | CLI 会话门 + 自托管 Actions（漂移红灯 + PR 评论） |
| Pro | ¥29/月 | 托管 PR 评论 + 增量同步 + 邮箱账号 |
| Team | ¥999/年/仓 | 组织规范 + 门禁托管 |

详见 [COMMERCIAL.md](COMMERCIAL.md)。
