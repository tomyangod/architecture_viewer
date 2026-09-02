# Architecture Viewer

**AI 写完代码后，自动看清架构变了什么。**

会话基线 → 变更图谱 → 影响面分析：IDE 状态栏 / PR 评论 / CLI 三端可用。
免费开源（Apache-2.0），零配置、秒级出图，不依赖 LLM。

> 痛点：AI 编码会话一次改动几十个文件，**合入前没人说得清架构到底变了什么**——
> 删了哪个被广泛依赖的类型？有没有跨层调用？新引入了哪些第三方包？谁会被波及？
> Architecture Viewer 在会话结束时给出 Before/After 架构对比和风险分级，红灯只亮在刀刃上。

---

## 三种用法

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

### 2. VS Code 扩展（状态栏角标）

命令面板（⇧⌘P）执行：

- `Architecture Viewer: Session Start（记录架构基线）`
- `Architecture Viewer: Session Report（查看架构变更报告）` — Webview 内展示报告
- `Architecture Viewer: Session Refresh（立即重新分析）`

保存文件时自动增量分析，状态栏角标实时显示风险等级（🟢/🟠/🔴）。

安装：VS Code 扩展市场搜索 `arch-viewer`，或下载 [Release](https://gitee.com/heyangyan/architecture_viewer/releases) 中的 `.vsix` 后「从 VSIX 安装」。

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

```bash
npx arch-viewer session start .        # 在你的项目根目录记录基线
echo '// 随便改点代码：新增/删除一个类或改个 import' 
npx arch-viewer session report .       # 看变更报告（加 --open 直接开 HTML 对比图）
```

其他常用命令：

```bash
arch-viewer extract <repo> --out graph.json      # 导出代码结构图谱
arch-viewer diff <base-dir> <head-dir> --json    # 结构 diff（JSON）
arch-viewer impact <base-dir> <head-dir>         # 影响面文本报告
arch-viewer pr-comment <base-dir> <head-dir>     # PR 评论 Markdown（--post 直接发）
arch-viewer workspace ...                         # 多仓基线管理
```

---

## 风险分级与影响面怎么算

- **风险发现**（`lib/risk-rules.js`）：跨层依赖违规、层级穿透（controller 直连 storage）、
  类型删除（按下游数量升降级）、新增外部依赖、高扇出变更、孤儿新实体。
- **影响面**（`lib/impact.js`）：从被改实体出发，沿 import/extends/implements/calls 等
  wiring 边**反向 BFS**（base 与 head 反向边取并集，穿透被改实体集群），
  报告集群边界之外的直接/间接受害者。归属关系边（declared-in）不参与。

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
├── lib/                              # 扫描 / diff / 影响面 / 风险规则 / 报告（CLI · 扩展 · Web 共用）
├── src/extension*.js                 # VS Code 扩展：会话命令 + 状态栏 + Webview
├── scripts/build-vsix.js             # 扩展打包（vsce）
├── scripts/pr-comment.js             # CI 评论入口
├── web/                              # 落地页 + API + /p/<id> 分享页
├── .github/workflows/                # architecture-check（漂移红灯）+ architecture-diff（PR 评论）
├── templates/                        # 可复制的套件与 CI 模板
└── eval/                             # 多语言解析夹具与评测
```

## 定价摘要

| 档位 | 价格 | 要点 |
|------|------|------|
| Community | ¥0 | CLI 会话门 + 自托管 Actions（漂移红灯 + PR 评论）+ 扩展 |
| Pro | ¥29/月 | 托管 PR 评论 + 增量同步 |
| Team | ¥999/年/仓 | 组织规范 + 门禁托管 |

详见 [COMMERCIAL.md](COMMERCIAL.md)。
