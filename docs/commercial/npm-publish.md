# 固定试点版发布：0.12.2-rc.4

> 2026-09-14（晚）：**已发布**到 npm 标签 `next`。`latest` 保持 `0.12.1`。源提交 `37d4700`（主仓 main）。发布物与本地打包 tarball 逐字节一致。
> 本版 = rc.3 结构验收链路 + **默认交付收缩**（generate 默认只写 Block；`--compat-six-views` 兼容；Archify 导出须 `--confirm`）+ Preview 可选 Tab 误隐藏修复。

包名：`arch-viewer`。二进制：`arch-viewer`、`arch-viewer-mcp`。

## 发布记录

| 项 | 值 |
|---|---|
| 版本 | `0.12.2-rc.4` |
| 标签 | `next`（未改 `latest`） |
| 源提交 | `37d4700` |
| 文件数 | 145 |
| SHA-256 | `c270330e2903492114422a5f3eb49b694aaa3ebc608018b7a91b69c8d5facb03` |
| integrity | `sha512-Qvzp0veav59pDIRLW9b6BcfSxWSXbPfs6Iv05GQwU3rKtB6hWrJx1H2mLB2j+znZQ8AnE/8JKu+5iLubrROeRA==` |
| registry shasum | `1abd6fc5b7fcd4b207228f5bbc90dbb26d75d288` |
| 发布方式 | 网页授权（`--auth-type=web`） |

## 试点安装

```bash
npm i -g arch-viewer@0.12.2-rc.4
# 或 npm i -g arch-viewer@next
arch-viewer --version   # 0.12.2-rc.4
```

一次性：

```bash
npx --yes --package arch-viewer@0.12.2-rc.4 arch-viewer --version
npx --yes --package arch-viewer@0.12.2-rc.4 arch-viewer session report /绝对路径/到仓库 --renderer builtin
```

详见 [quickstart](../guides/quickstart.md)。

## 发布后复验（2026-09-14）

- `npm view arch-viewer dist-tags` → `latest=0.12.1, next=0.12.2-rc.4` ✅
- registry integrity 与本地 `openssl sha512` 计算一致 ✅
- 下载 registry tarball：SHA-256 `c270330e…` 与源提交 `37d4700` 的本地打包**逐字节一致** ✅
- 全新目录 `npm install arch-viewer@0.12.2-rc.4` → `arch-viewer --version` = `0.12.2-rc.4` ✅
- 发布前检查：语法检查 + 全量单测 **952 通过 / 0 失败 / 1 跳过** ✅
- 真实托管 PR 与外部团队接入仍 **NOT RUN**，不记为客户安装/激活。

## 与 rc.3 的关系

- `0.12.2-rc.3`（源提交 `81e6c43`）2026-09-14 上午发布，仍是有效回退版本：核心结构验收链路（av_guard / session report / PR 评论）两版一致。
- rc.4 的差异仅：默认可视化交付收缩（Block-only）、旧图保留回执、Archify 人工确认、Preview Tab 修复。试点若只做「AI 改完 → 看灯 → 提交」，两版等效。
