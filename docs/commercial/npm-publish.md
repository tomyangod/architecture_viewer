# 固定试点版发布：0.12.2-rc.5

> 2026-09-15：**待发布**到 npm 标签 `next`（需显式授权后执行）。`latest` 保持 `0.12.1`。发布源提交 `299a8b8`（含修复 `16a0b37` + 版本钉 `5c8f3f2`）。
> 本版 = rc.4 默认交付收缩 + **会话解释闭环 / CRLF 归因 / 测试关联措辞 / 手改图保护 / 未确认分层不阻断**。

包名：`arch-viewer`。二进制：`arch-viewer`、`arch-viewer-mcp`。

## 发布记录

| 项 | 值 |
|---|---|
| 版本 | `0.12.2-rc.5` |
| 标签 | `next`（未改 `latest`） |
| 源提交 | `299a8b8` |
| 干净树 tarball SHA-256 | `4d9fcb365f2cc4f3a3968f5fc93a0212fb8b07947c3e0fac0308d6a724105f43` |
| registry shasum（pack） | `c070fcd8541d1ca1f22c7529d155fe31685e1e76` |
| integrity（pack） | `sha512-VaxKYObgUmZ8siuestCnjTDnnld/c1oZWbs2ub20jtEO2b/0QVUXtZ7bm9LaaKjlvH3FdjNg3p2OkWwKRHysiw==` |
| 文件数 | 146 |
| 发布方式 | 待网页授权 / `npm publish --tag next` |

## 试点安装

```bash
npm i -g arch-viewer@0.12.2-rc.5
# 或 npm i -g arch-viewer@next
arch-viewer --version   # 0.12.2-rc.5
```

一次性：

```bash
npx --yes --package arch-viewer@0.12.2-rc.5 arch-viewer --version
npx --yes --package arch-viewer@0.12.2-rc.5 arch-viewer session report /绝对路径/到仓库 --renderer builtin
```

详见 [quickstart](../guides/quickstart.md)。

## 口径提醒

- 对话三行 verdict 灯色跟 `riskSummary.level`；退出码跟 `gateLevel`。未确认跨层可能 🟠 + exit 0。
- 不要把未提交 / dirty 工作区 tarball 当作已发布的 rc.4 或 rc.5。
- 本地验收（2026-09-15）：全量单测 1028 通过 / 0 失败 / 1 跳过；离线安装包回归 189 通过；干净 `git archive` 打包冒烟 `--version=0.12.2-rc.5`。

## 上一版（rc.4）摘要

| 项 | 值 |
|---|---|
| 版本 | `0.12.2-rc.4` |
| 源提交 | `37d4700` |
| SHA-256 | `c270330e2903492114422a5f3eb49b694aaa3ebc608018b7a91b69c8d5facb03` |
| 发布日 | 2026-09-14 → npm `next` |
