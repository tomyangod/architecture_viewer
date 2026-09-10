# Team 私有化：报价、交付物、SLA

适用：代码不能出网、采购要合同/发票、需要内网 Web + CI 门禁的团队。  
SaaS Team（¥999 / 年 / 仓库）走落地页下单，见 [COMMERCIAL.md](COMMERCIAL.md)、[billing.md](billing.md)。本文是 **内网交付** 的敲门砖。

意向与试点记录：[pm/pilots.md](../../pm/pilots.md)「Team 私有化意向」。开票：[invoice.md](invoice.md)。工单：[support.md](support.md)。

## 和 SaaS Team 怎么选

| | SaaS Team | 私有化 On-prem |
|---|---|---|
| 价格 | ¥999 / 年 / 仓库 | **¥19,999 / 年起**（部署 + 对接 + 一年支持） |
| 数据 | 你的仓仍在自己 Git；托管的是评论与账号 | 全部跑在你的 VPC / 机房，无强制外网 |
| 采购 | 落地页 / 对公转账 | 书面意向 → 报价单 → 合同 / 对公 |
| 适合 | 公开或可出网的仓、要托管 PR 评论 | 金融、政务、核心业务仓、无外网 CI |

Community CLI / `docker compose` **可以自己搭**，不收费。私有化买的是：**交付、对接、SLA、可选私有 LLM 与审计**，不是把开源锁起来。

## 报价档位（人民币，含一年支持）

| 档位 | 价格 | 范围 | 包含 |
|---|---|---|---|
| **On-prem 入门** | **¥19,999 / 年** | 1 套内网部署、最多 **3** 个仓库门禁 | 安装包/Compose、账号与 Admin grant、CI 模板对接（GitHub/Gitee/自建二选一）、`architecture-rules` 初稿、工作日 SLA、电子发票 |
| **On-prem 标准** | **¥39,999 / 年** | 最多 **10** 仓 | 入门全部 + 企业微信告警对接 + 规范包联调 1 次 + 季度健康度（漂移误报复盘） |
| **On-prem 扩展** | 另议 | 10 仓以上、多套环境、SSO / 私有 LLM | 按仓加购 **¥4,999 / 仓 / 年**；SSO、离线模型、审计日志走 [W13-05](../../pm/tasks/W13/README.md) 范围单列 |

一次性（可叠加，不做订阅也能买）：

| 项目 | 价格 | 说明 |
|---|---|---|
| 架构健康度诊断 | ¥4,999 / 次 | 全量 `session report` + 不超过 10 页书面结论 |
| 分层 / rules 定制 | ¥9,999 起 | 按你们的模块约定写 `architecture-rules.yaml` |

价格不含差旅；远程交付为默认。报价有效期 30 天。续费按当年档位，提前 30 天对公续约。

## 交付物

1. **运行时**
   - 内网 Web：`docker compose up -d`（或 Node 18+ `HOST=0.0.0.0 npm run web`），默认 `:3847`
   - 数据卷 `.data/`（项目、Pro 账号），不出你们的盘
   - 离线 Mermaid（`vendor/`），生成与预览不依赖公网 CDN
2. **门禁**
   - CI 工作流模板（GitHub Actions / Gitee Go），`arch-viewer check --drift --filled --rules`
   - 可选：内网 Webhook → 本机托管 PR 评论（需你们提供 Git PAT，存在你们的密钥库）
3. **规范**
   - 一份针对试点仓的 `architecture-rules.yaml` 初稿（命名 / 禁跨层 / Rel 白名单）
4. **文档与账号**
   - 开通清单、Admin grant 命令、发票信息表
   - 1 个运营管理员账号；业务用户自助注册或由你们导入邮箱
5. **不包含（除非扩展档单列）**
   - 源码版权转让（仍是 Apache-2.0 + 商业支持合同）
   - 公有云代运维、你们业务代码的架构改造实施
   - Marketplace 扩展上架（Community 已开源，可内网 sideload）

## 交付节奏（入门档，远程）

| 日 | 事项 | 验收 |
|---|---|---|
| D0 | 书面意向 + 仓库名单（HTTPS 或内网 Git）+ 开票抬头 | 记入 `pm/pilots.md` |
| D1–D2 | 内网机器：Docker 或 Node 18，能拉镜像或拷安装包 | `curl -sI http://内网:3847/api/health` 200 |
| D3 | 试点仓 `session start` + 首张六视图 + check 绿/红可解释 | 双方确认漂移清单 |
| D4 | CI 模板合入；rules 初稿进仓 | 一条测试 PR 能红/能绿 |
| D5 | 开通账号、发票、SLA 联络人 | 签字或邮件确认「已交付」 |

标准档在此基础上加企微与季度复盘排期。

## 安装（客户侧可自助预演）

内网有 Docker：

```bash
git clone https://gitee.com/heyangyan/architecture_viewer.git
cd architecture_viewer
# 生产请改 ARCH_PRO_SECRET
docker compose up -d
# http://<内网主机>:3847/
```

无 Docker、仅 Node ≥ 18：

```bash
npm ci --omit=dev
HOST=0.0.0.0 PORT=3847 npm run web
```

CLI 门禁（可完全离线）：

```bash
npx arch-viewer session start
npx arch-viewer check . --drift --filled --rules architecture-rules.yaml
```

无外网时用发行包或内网 npm 镜像；不要把 `.data/`、`ARCH_PRO_SECRET`、Git PAT 提交进仓。

## SLA（合同默认，可加钱升级）

| 项 | 入门 / 标准 |
|---|---|
| 支持时段 | 北京时间工作日 10:00–19:00 |
| 首次响应 | P0（服务不可用 / 开通失败）**8 小时内**；P1（误报、登录）**1 个工作日**；P2（文档）排队 |
| 渠道 | 指定邮箱 + 私有 Issue / 群；勿在公开仓贴密钥 |
| 可用性目标 | 客户自托管，**基础设施由客户负责**；我们保证软件缺陷的修复承诺：P0 下一工作日给出规避或补丁计划 |
| 升级 | 标准档含每季 1 次漂移误报复盘（书面纪要） |
| 数据 | 我们不拷贝你们的源码；远程协助需你们授权屏幕或脱敏日志 |
| 退出 | 合同期满可停付；Community 能力继续可用；我们协助导出 `.data/` |

更严的 7×24 / 驻场在扩展档另议。

## 书面意向怎么算（W12-01）

下列任一即可记入 [pm/pilots.md](../../pm/pilots.md)，**不要口头**：

- 工作邮箱回复「同意按 On-prem 入门档启动试点」并写仓库数
- 盖章/扫描的报价确认页
- 对公预付或正式订单号（可与 [invoice.md](invoice.md) 同一单）

模板（可直接转发）：

```
主题：Architecture Viewer 私有化试点意向

我们拟按《Team 私有化》入门档（¥19,999/年，最多 3 仓）启动试点。
试点仓库：
1. https://…
联系人 / 开票抬头：
希望交付窗口：
```

发到公开 Issue 即可（不要附税号扫描件）；或按发票页走邮件。

## 相关文档

- 开源边界与 SaaS 定价：[COMMERCIAL.md](COMMERCIAL.md)
- 收款开通：[billing.md](billing.md)
- 落地页部署：[landing-deploy.md](landing-deploy.md)
- 发票：[invoice.md](invoice.md)
