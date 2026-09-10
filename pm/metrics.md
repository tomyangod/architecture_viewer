# 指标台账（每周五随周报更新）

> 数据源：npm 下载量 + CLI/网页遥测（默认关）+ Pro 支付/账号后台。  
> VS Marketplace / Open VSX 待扩展重启后再加。  
> 周报脚本引用本表口径（`pm/scripts/wbs-report.mjs` §六）；数值用 `node pm/scripts/metrics-pull.mjs` 拉取后人工确认写入。  
> **可视化看板**：启动 web 服务后访问 `/metrics.html`（API: `GET /api/metrics`），自动聚合 npm + Pro store + 漏斗事件，5 分钟缓存。

## 数据口径

| 指标 | 定义 | 主数据源 | 刷新 |
|---|---|---|---|
| **累计安装** | npm 包 `arch-viewer` 自首次发布日起的下载累计（proxy/镜像会计入，偏高；作上界） | [npm downloads API](https://api.npmjs.org/downloads/point/…) | 每周五 |
| **周新增安装** | 当周自然周（周一–周日，UTC）下载量 | 同上 range | 每周五 |
| **周活跃** | 当周至少触发 1 次 CLI 主命令（`cli_command`）或网页 `/api/generate` 成功的去重设备/会话 | 开启 `ARCH_TELEMETRY=1` 后的 `~/.config/arch-viewer/telemetry.log`；网页侧待接同一埋点 | 每周五 |
| **Generate 触发** | 当周 `generate` / `session report` / Web `POST /api/generate` 成功次数 | 遥测 `cli_command` + 网页访问日志（自托管） | 每周五 |
| **Pro 登录** | 当周 Pro 控制台成功登录次数（去重用户） | 生产 `.data/pro/store.json` sessions / 事件；**不含**本机 smoke 测试账号 | 每周五 |
| **试用 / 付费** | 新开 trial 数 / 付费订单数 | 支付渠道 + `pm/metrics.md` 订单流水 | 每周五 |

**隐私**：遥测默认关；开启后只记事件名、时长、退出码、版本、平台，不含路径/代码/仓库 URL。详见 README 隐私段与 `lib/telemetry.js`。

**暂缓**：Marketplace 安装量（W06-01 deferred）。

## 拉取命令

```bash
# 打印本周 npm 下载 + 建议填入行（不改文件）
node pm/scripts/metrics-pull.mjs

# 指定周区间（UTC）
node pm/scripts/metrics-pull.mjs --from 2026-09-01 --to 2026-09-07

# 生成周报时会提示对照本文件
npm run wbs -- report --week W06
```

## 漏斗基准（调研值，有真实数据后校正）

| 环节 | 行业基准 | 本项目目标（保守） | 备注 |
|---|---|---|---|
| 安装 → 激活 | 30–50% | ≥35% | 周活跃 / 周新增安装 |
| 激活 → 周留存 | 20–30% | ≥20% | 需遥测开启样本 |
| 月活 → 付费 | 0.5–1% | 0.5–1%（非 2%） | 回本按 12–18 个月 |
| 月收入预期（6 个月） | — | ¥1k–3k | Pro ¥29/月 + Team ¥999/仓/年 |

## 周度记录

| 周次 | 累计安装 | 周新增安装 | 周活跃 | Generate 触发 | Pro 登录 | 试用 | 付费数 | 收入(¥) | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| **W06 首周**（2026-09-01～09-05） | **392** | **392** | 0* | 0* | 0† | 0† | 0 | 0 | npm `arch-viewer` 首次发布 0.2.1→0.3.1（2026-09-01）。日明细见下。台账首记 375（9/05 当日 API 滞后）；**2026-09-05 晚回刷 API=392**（补上 9/04=17）。\*遥测默认关。†本机 `.data/pro` 仅 smoke。落地页 W06-02 已上线；本地包 0.11.0 尚未 `npm publish`。 |
| W07 |  |  |  |  |  |  |  |  |  |
| W08 |  |  |  |  |  |  |  |  |  |
| W09 |  |  |  |  |  |  |  |  | 里程碑：首笔 Pro |
| W10 |  |  |  |  |  |  |  |  |  |
| W11 |  |  |  |  |  |  |  |  |  |
| W12 |  |  |  |  |  |  |  |  | 里程碑：Team 试点意向 |

### 首周明细（npm，UTC）

| 日 | 下载 |
|---|---|
| 2026-09-01 | 355 |
| 2026-09-02 | 20 |
| 2026-09-03 | 0 |
| 2026-09-04 | 17 |
| 2026-09-05 | 0（API 可能仍滞后） |
| **合计** | **392** |

> 注：仓库本地 `package.json` 已到 `0.11.0`，npm 最新公开发布仍为 `0.3.1`。周安装以 registry 为准；下次 `npm publish` 后再对齐版本列。对外口径可写「台账首记 375 / API 现 392」。

## 付费订单流水

> W09-03：至少 1 行 **真实** Pro 到账（订单号 + 开通确认）。沙箱 / 自测 grant **不算**。开通命令见 [docs/commercial/billing.md](../docs/commercial/billing.md)。

| 日期 | 订单号 | 类型（Pro/Team） | 金额 | 渠道 | 注册邮箱（可打码） | 开通确认 | 状态 |
|---|---|---|---|---|---|---|---|
|  |  | Pro |  | 爱发电 / 微信 / Lemon / Stripe |  | whoami=pro / 控制台 active | 待首笔 |
