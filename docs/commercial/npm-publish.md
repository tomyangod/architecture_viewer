# 固定试点版发布：0.12.2-rc.2

> 2026-09-11：候选版本仅在本地准备，尚未发布。查询时 registry `latest=0.12.1`、`next=0.12.2-rc.1`；不可重用已发布版本号。发布前重新查询。

包名：`arch-viewer`。二进制：`arch-viewer`、`arch-viewer-mcp`。

## 本地准备（不提交、不发布）

1. 审阅 `git status --short` 和 diff，保留他人改动。新增的 `lib/scan-ignore.js`、测试必须纳入最终提交；临时报告、客户代码、凭据、`.data/` 不得混入。
2. 核对 `package.json`、`package-lock.json` 与 CHANGELOG 的候选版本一致。
3. 执行既有发布校验：

```bash
npm run prepublishOnly
npm pack --dry-run --json
```

4. `npm pack --pack-destination <已创建的产物目录>`，保存 tarball、SHA-256、包清单、Node/npm/平台版本和验证日志。
5. 在仓库外的全新目录执行 `npm install <tarball绝对路径>`。从安装后的包运行 [冒烟清单](../../pm/checklists/release-smoke.md)，不可借用主仓 `node_modules`。
6. 架构报告允许记录已知 HIGH，但须由负责人审核处置。不得为了发布刷新基线、自动接受或降低阈值。默认 git HEAD 模式以接受后的 commit 为对照；快照模式的刷新另行授权。

## 包文件检查

必须含 `bin/`、`lib/scan-ignore.js`、`mcp/`、`web/`、`templates/`、两份 welcome HTML、六张套件图源、LICENSE、NOTICE。

不得含 `.env`、`.data/`、`.av/`、客户仓库、测试产物、`pm/`、临时评论、视频或本地凭据。以 tarball 实际清单为准，不只检查 `files` 字段。

## 提交和发布（必须另获授权）

1. 整理提交并确认源代码无遗漏；批准架构变更。认证由维护者交互完成，不在日志或材料中保存 token。
2. 从该干净提交重新执行发布检查与打包、安装验证。若包内容变化，原来的校验结果不能替代复验。
3. 确认 `npm view arch-viewer@0.12.2-rc.2 version --registry https://registry.npmjs.org` 仍返回版本不存在；网络/鉴权失败不能当作不存在。
4. 只发布复验后的 tarball，候选版使用 `next`，不改 `latest`：

```bash
# 以下为维护者批准后的手动操作，不属于本地准备
npm publish <复验通过的tarball绝对路径> --tag next --access public --registry https://registry.npmjs.org
```

`next` 已有旧候选版，移动该标签需要负责人确认。不要使用会自动升版本或创建 tag 的发布脚本代替本流程。

## 发布后复验

在另一个全新目录执行：

```bash
npm view arch-viewer@0.12.2-rc.2 dist.integrity --registry https://registry.npmjs.org
npm install --save-exact arch-viewer@0.12.2-rc.2 --registry https://registry.npmjs.org
npx --no-install arch-viewer --version
```

将 registry integrity 与已发布 tarball 的 integrity 对比，再跑绿灯、违规 exit 1、配置错误、scope 提示及 MCP 初始化。完成 [真实托管 PR 验收](PRO-SAAS.md#真实托管-pr-验收发布后执行) 后才标记远端链路通过。

记录发布提交、版本、时间和结果至 [指标台账](../../pm/metrics.md)，不把本地 tarball 写成 npm 已发布。收到的首购与续费分别记账，沙箱开通不算到账。
