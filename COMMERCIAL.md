# 开源边界与商业版

本仓库以 **Apache License 2.0** 发布 **Community** 能力。你可以免费使用、修改、再分发 Viewer、模板、校验 CLI、网页自托管与 Cursor/VS Code 扩展（含署名与 NOTICE 义务，见 [LICENSE](LICENSE)、[NOTICE](NOTICE)）。

生成结果（写入目标仓库的 6 个 `.md`）归你的项目所有。

## 收费理由（顺序即卖点优先级）

1. **防漂移闭环（主楔子）**：Community 用 [templates/architecture-check.yml](templates/architecture-check.yml) 在 PR 上红灯；**Pro** 把同一检查做成托管评论与门禁看板，团队不用自己维护 Action。
2. **自动同步**：增量重生成变动模块，架构图跟着仓库走。
3. **团队制图规范**：`architecture-rules.yaml`（节点命名、禁止跨层、Rel 白名单）。
4. **六视图门户**：C4 + 分层 + 类图 + 运维，作为交付物而非订阅本体。

一句话：**出图是诱饵，漂移红灯才是订阅理由。**

## 定价

| 档位 | 价格 | 包含 |
|------|------|------|
| **Community** | ¥0 | 开源扩展 / CLI / 本机网页；Init、Generate（骨架）、`--refine`（自带 Key）；**Actions 漂移模板**；Preview、Validate、自托管分享页 |
| **Pro** | **¥29 / 月** | 账号 + 7 天试用；**本机文件夹检查 + 企业微信提醒**；托管 PR 漂移评论；Stripe 或许可证 |
| **Team** | **¥999 / 年 / 仓库** | 共享图库、组织规范、CI 门禁托管；私有化另议 |

Community 采用固定免费档，**不会**把单次调用次数当作付费墙。Pro 是固定月费。

## 双产品形态

| 面 | 谁用 | Community | Pro / Team |
|----|------|-----------|------------|
| **Cursor / VS Code 扩展** | 作者，图写进仓库 | Init / Generate / Preview / Validate | 增量同步、漂移评论、账户 |
| **网页版** (`web/`) | 评审、分享、无 IDE | 本机/自托管样例与分享页 `/p/<id>` | 云端 Git 导入、私密链接、组织图库 |
| **CI** | 全员 | 自托管 Actions 模板 | 托管门禁 + PR 评论 |

两条面共用 `lib/`。Viewer HTML 是交付物，不是收费本体。

## Community（开源，本仓库）

| 能力 | 说明 |
|------|------|
| Viewer 套件 | HTML、配置、6 个图源、`AGENT.md`、离线 `vendor/mermaid.min.js` |
| 扩展命令 | **Init** / **Generate** / **Preview** / **Validate** |
| 网页 MVP | `npm run web` |
| CLI | `node lib/cli.js init \| generate [--refine] \| check` |
| CI | [templates/architecture-check.yml](templates/architecture-check.yml) + `eval/demo-drift` 坏图必须失败 |

## Pro / Team

- **Pro**：`/account.html` 账号与 7 天试用；**本地文件夹检查**（不用 GitHub/Gitee）+ 可选企业微信；以及 `POST /api/pro/webhook` 托管 PR 评论。见 [docs/PRO-SAAS.md](docs/PRO-SAAS.md)。
- 云端增量同步、组织图库、SSO：仍为后续 Team 能力
- 私有 LLM、离线安装包、审计、发票流程：[docs/invoice.md](docs/invoice.md)、[docs/support.md](docs/support.md)

Community 扩展与网页**不会**为 Generate/Validate「电检」许可证。Pro 登录是可选增值层。

## 第三方

图渲染打包 [Mermaid](https://github.com/mermaid-js/mermaid) 11.6.0（MIT），见 [NOTICE](NOTICE)。不要把 `.env`、密钥写进图源。

## 商标

「Architecture Viewer」名称与扩展图标仅用于标识本项目。再分发衍生作品时请改名，以免与官方 Marketplace 条目混淆。
