# 固定试点版发布：0.12.2-rc.3

> 2026-09-14：**已发布**到 npm 标签 `next`。`latest` 保持 `0.12.1`。源提交 `81e6c43`（独立整合仓，非主仓未提交开发）。registry integrity 与干净 `git archive` tarball 逐字节一致。

包名：`arch-viewer`。二进制：`arch-viewer`、`arch-viewer-mcp`。

## 发布记录

| 项 | 值 |
|---|---|
| 版本 | `0.12.2-rc.3` |
| 标签 | `next`（未改 `latest`） |
| 源提交 | `81e6c43eba0d61ff12e49c468c2608aba08fbb15` |
| 文件数 | 144 |
| SHA-256 | `4c18d22d37ae83ed8d047df4406d6e3a2b4445f1efe37ce5817e79b9a1aab381` |
| integrity | `sha512-FKj7JjTbS4vdZk2BFREC192CMXiPbLg6/6kExT5BS+RNWCaXzbGNn7CUsDUcxGrtLfUxyh7vtWCg72x5wJzExg==` |
| registry shasum | `4662b77d58340e0311dbc460f2347ee10d85084d` |
| 发布时间 | 2026-09-14T11:57:52.743Z |

## 试点安装

```bash
npm i -g arch-viewer@0.12.2-rc.3
# 或 npm i -g arch-viewer@next
arch-viewer --version   # 0.12.2-rc.3
```

一次性：

```bash
npx --yes --package arch-viewer@0.12.2-rc.3 arch-viewer --version
npx --yes --package arch-viewer@0.12.2-rc.3 arch-viewer session report /绝对路径/到仓库 --renderer builtin
```

详见 [quickstart](../guides/quickstart.md)。

## 发布后复验（2026-09-14）

```bash
npm view arch-viewer dist-tags --registry https://registry.npmjs.org
# => latest=0.12.1, next=0.12.2-rc.3

npm view arch-viewer@0.12.2-rc.3 dist.integrity --registry https://registry.npmjs.org
# 与上表 integrity 一致

npm install --save-exact arch-viewer@0.12.2-rc.3 --registry https://registry.npmjs.org
npx --no-install arch-viewer --version   # 0.12.2-rc.3
```

registry tarball 与本地干净包 SHA-256 / shasum 一致。干净安装确认含 `references-unresolved`、骨架图 `static draft`、HTML「Human review required」。

真实托管 PR 验收仍按 [PRO-SAAS](PRO-SAAS.md#真实托管-pr-验收发布后执行) 单独执行，当前 **NOT RUN**。

## 历史：0.12.2-rc.2（2026-09-11）

上一试点钉。`next` 已改指 rc.3。源提交 `d3e409d`；SHA-256 `ef39d428e42a508587ddff1d8457c38bec479085f90c5d182f879c090abdec44`；integrity `sha512-Zcb/fi8dQoVMXKjpPCDPa8ikYIc55mdBBuH9bMjeqLS0q9HDi+NzUwHOkrHYWIv8vB5OcLpvV9DdWztLX7v6Bw==`。
