# 固定试点版发布：0.12.2-rc.6

> 2026-09-15：**已发布**到 npm 标签 `next`。`latest` 保持 `0.12.1`。发布源提交 `8863ed6`（含修复 `f05c3de` + 版本钉 `8863ed6`）。
> 本版 = rc.5 解释闭环与分层门禁解耦 + **出图页脚如实化 / 环路径消歧 / explain 结构化证据 / snapshot 基线口径明示**。

包名：`arch-viewer`。二进制：`arch-viewer`、`arch-viewer-mcp`。

## 发布记录

| 项 | 值 |
|---|---|
| 版本 | `0.12.2-rc.6` |
| 标签 | `next`（未改 `latest=0.12.1`） |
| 源提交 | `8863ed6` |
| 干净树 tarball SHA-256 | `bb6ed0d26815b3c8b7c53d7fc2b708fff7c63ef44865142488ea46b7603d47b1` |
| registry shasum | `0138d89dff28cedbbca21a76f4d691b696ecc40f` |
| integrity | `sha512-AIubHdFrxo3H6EzJDyp14gZUu+Urj95R4Wv0+lpYhzaCxprUkHb6oOLK4m5cq1LDXUe3Pgg6SeOOXxN8CsIV7A==` |
| 文件数 | 146 |
| 发布时间 | 2026-09-15T06:34:38.286Z |
| 发布方式 | 干净 `git archive` tarball + `npm publish --tag next`（网页 2FA） |

## 试点安装

```bash
npm i -g arch-viewer@0.12.2-rc.6
# 或 npm i -g arch-viewer@next
arch-viewer --version   # 0.12.2-rc.6
```

一次性：

```bash
npx --yes --package arch-viewer@0.12.2-rc.6 arch-viewer --version
npx --yes --package arch-viewer@0.12.2-rc.6 arch-viewer session report /绝对路径/到仓库 --renderer builtin
```

详见 [quickstart](../guides/quickstart.md)。

## 发布后复验（2026-09-15）

- `npm view arch-viewer dist-tags` → `latest=0.12.1`, `next=0.12.2-rc.6`
- 下载 registry tarball SHA-256 与本地干净打包逐字节一致
- 全新目录 `npm install arch-viewer@0.12.2-rc.6` → `arch-viewer --version` = `0.12.2-rc.6`

## 口径提醒

- 对话三行 verdict 灯色跟 `riskSummary.level`；退出码跟 `gateLevel`。未确认跨层可能 🟠 + exit 0。
- 编排流水线页脚只证明路径/语法/层归属的静态校验，不证明运行时语义。
- 不要把未提交 / dirty 工作区 tarball 当作已发布的 rc.4、rc.5 或 rc.6。
- 本地验收（2026-09-15）：全量单测 1034 通过 / 0 失败 / 1 跳过；离线安装包回归 195 通过。

## 上一版（rc.5）摘要

| 项 | 值 |
|---|---|
| 版本 | `0.12.2-rc.5` |
| 源提交 | `b139e31` |
| SHA-256 | `4d9fcb365f2cc4f3a3968f5fc93a0212fb8b07947c3e0fac0308d6a724105f43` |
| 发布日 | 2026-09-15 → 当时 npm `next`；现已改指 rc.6 |
