# 固定试点版发布：0.12.2-rc.2

> 2026-09-11：**已发布**到 npm 标签 `next`。`latest` 保持 `0.12.1`。源提交 `d3e409d`。registry integrity 与本地复验 tarball 一致。

包名：`arch-viewer`。二进制：`arch-viewer`、`arch-viewer-mcp`。

## 发布记录

| 项 | 值 |
|---|---|
| 版本 | `0.12.2-rc.2` |
| 标签 | `next`（未改 `latest`） |
| 源提交 | `d3e409d` |
| 文件数 | 141 |
| SHA-256 | `ef39d428e42a508587ddff1d8457c38bec479085f90c5d182f879c090abdec44` |
| integrity | `sha512-Zcb/fi8dQoVMXKjpPCDPa8ikYIc55mdBBuH9bMjeqLS0q9HDi+NzUwHOkrHYWIv8vB5OcLpvV9DdWztLX7v6Bw==` |
| registry shasum | `df02520714e132cd4cce72844795a9fa9f0104f7` |

## 试点安装

```bash
npm i -g arch-viewer@0.12.2-rc.2
# 或 npm i -g arch-viewer@next
arch-viewer --version   # 0.12.2-rc.2
```

一次性：

```bash
npx --yes --package arch-viewer@0.12.2-rc.2 arch-viewer --version
npx --yes --package arch-viewer@0.12.2-rc.2 arch-viewer session report /绝对路径/到仓库 --renderer builtin
```

详见 [quickstart](../guides/quickstart.md)。

## 发布后复验（2026-09-11）

```bash
npm view arch-viewer dist-tags --registry https://registry.npmjs.org
# => latest=0.12.1, next=0.12.2-rc.2

npm view arch-viewer@0.12.2-rc.2 dist.integrity --registry https://registry.npmjs.org
# 与上表 integrity 一致

npm install --save-exact arch-viewer@0.12.2-rc.2 --registry https://registry.npmjs.org
npx --no-install arch-viewer --version   # 0.12.2-rc.2
```

CLI 冒烟（全新目录、snapshot 临时仓）：无基线 exit 4 → start 绿灯 exit 0 → 跨层红灯 exit 1 → 修复 exit 0 → 坏规则 exit 2。

真实托管 PR 验收仍按 [PRO-SAAS](PRO-SAAS.md#真实托管-pr-验收发布后执行) 单独执行，当前 **NOT RUN**。

## 历史准备步骤（已完成，备查）

1. `prepublishOnly`：840 通过 / 0 失败 / 1 跳过。
2. `npm pack` 复验，排除 `.env` / `.data` / `.av` / `pm` / `test`。
3. 维护者本机 OTP 认证后：

```bash
npm publish /tmp/av-publish-0.12.2-rc.2/arch-viewer-0.12.2-rc.2.tgz --tag next --access public --registry https://registry.npmjs.org
```
