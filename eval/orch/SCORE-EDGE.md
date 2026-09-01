# Edge-case 四仓：用法1 vs 用法5（orch4）

样本（刻意偏离「Web 应用七层」）：

| 仓库 | 为何是 edge |
|------|-------------|
| **ntfy** | 产品本身就是通知总线（pub/sub），不是业务系统外挂告警 |
| **vaultwarden** | Rust；官方客户端在仓外；本仓几乎没有产品 SPA |
| **zigbee2mqtt** | Zigbee↔MQTT 桥，主干不是 HTTP CRUD；TS 动态入口 |
| **caddy** | 反向代理 / TLS 平台，没有产品前端 |

日期：2026-08-30  
产物：`/tmp/arch-orch/out/usage1-<repo>/` 与 `/tmp/arch-orch/out/orch4/<repo>/`

## 结论

上一轮五仓（Flask/Go/Vue/Next 应用）盲评差距约 **−0.4**。这四仓把差距重新拉开到约 **−1.7**。

原因不是又开始造假路径（四仓 orch4 **幻觉仍为 0**），而是 **闸门与七层模板在「非应用型」仓库上惩罚对的图、奖励套模板的图**。

| 口径 | 用法1 | 用法5 orch4 |
|------|------:|------------:|
| **交付均分** | **8.5** | **6.8** |
| 幻觉路径 | 全 0 | 全 0 |
| 层错 | vaultwarden 1（启发式） | 全 0 |
| 结构 hard | z2m 9 / caddy 1（见下） | 全 0 |

用法1 的「结构 hard」几乎全是 **闸门误伤**：把 MQTT Broker / 上游站点当「人角色」，并把 zigbee2mqtt 整个 `lib/` 判成「旁路」（import 图追不到 `index.js`）。orch4 过闸漂亮，但 z2m 把控制器、MQTT、Zigbee 适配器全部标成「可选」。

## 逐仓交付分

| 仓库 | 用法1 | 用法5 | Δ | 一句话 |
|------|------:|------:|--:|--------|
| ntfy | 8.6 | 7.5 | −1.1 | 主链路都对；orch4 硬凑 7 层，用户管理塞进 worker |
| vaultwarden | 8.4 | 7.2 | −1.2 | Rust 入度全 0；orch4 漏入口/邮件，子图2 在讲部署 |
| zigbee2mqtt | 8.5 | 5.8 | −2.7 | **最惨**：可达性把 `lib/` 打成旁路，主干全标可选 |
| caddy | 8.3 | 6.5 | −1.8 | HTML 模板被当成「前端层」；Caddyfile 塞进 ops |
| **均分** | **8.5** | **6.8** | **−1.7** | |

## 机评（`score-edge.js`）

格式：幻觉 / 层错 / 结构 high / 锚点 / 层数

| 仓库 | 用法1 | orch4 |
|------|-------|-------|
| ntfy | 0 / 0 / 0 / 4/5 / 5 | 0 / 0 / 0 / 5/5 / 7 |
| vaultwarden | 0 / 1 / 0 / 4/4 / 5 | 0 / 0 / 0 / 4/4 / 4 |
| zigbee2mqtt | 0 / 0 / **9** / 1/2 / 5 | 0 / 0 / 0 / 1/2 / 7 |
| caddy | 0 / 0 / 1 / 1/4 / 5 | 0 / 0 / 0 / 4/4 / 7 |

orch4 锚点覆盖更高，是因为它 **必须画上自己选中的锚点**（包括错误锚点：caddy 的 `templates`、z2m 的 `test/assets`）。

## 分仓解释

### ntfy（相对最接近）

用法1 按产品画：发布者 PUT → `server/` → `db/` / 附件 → 邮件、WebPush、FCM。空层不画（无独立 worker 池）。

orch4 路径全部真实，发布/订阅故事也在。但强制 7 层：`user/manager.go` 进 worker，`webpush/store.go` 进 worker，并造了一个外部角色「ntfy服务器」。邮件通道 `mail/` 被 Twilio/FCM 挤掉。

### vaultwarden（语言取证失效）

Rust `use` 图几乎建不起来（重要性：51 条边，锚点 heat 全 0）。orch4 抓住 `src/api`、`src/static`、`migrations`、`docker`，**漏了 `src/main.rs` 和 `src/mail.rs`**。`src/static` 被写成「Web Vault」——官方 Vault 客户端不在本仓。子图2 主链路变成「用户部署 Docker」。

用法1 的 1 处层错是闸门把 `src/api/push.rs` 判成必须在 API 层；业务上放通知层合理。

### zigbee2mqtt（引擎假设被打穿）

重要性取证把 `lib/`、`lib/extension`、`lib/mqtt.ts`、`lib/zigbee.ts` 全部标成 **旁路**（「从进程入口不可达」）。真实入口是根上 `index.js` 拉起 TS，静态 import 图追不上。

后果：

- 锚点变成 `docker` + **`test/assets`（当 frontend）**
- story 闸门禁止主链路经过 `lib/controller.ts` / `lib/mqtt.ts`
- 图上 Controller、MQTT、Zigbee 适配器都带「（可选）」
- 扫尾删掉 `mqtt → MQTT Broker`（当成非法方向）

用法1 的 9 条结构 hard 是同一套错误启发式：核心模块=旁路，Broker=人角色。

### caddy（把平台套成应用）

没有产品 UI。orch4 因 heat 把 `modules/caddyhttp/templates` 选成 **frontend**（那是响应 HTML 模板，不是管理台），`internal/sockets.go` 选成 realtime。Caddyfile 被放进 ops 层还被当成外部角色，终检留下 2 条 visual high。反向代理/TLS 数据面被塞进「worker / 采集」。

## 和五仓追平实验的关系

| | 常规 Web 应用（上轮 5 仓） | 本轮 edge 4 仓 |
|--|---------------------------|----------------|
| 七层语义 | 大致匹配 | 经常不匹配 |
| import 可达性 | 大体可用 | Rust / 动态 JS 入口会崩 |
| 「旁路」闸门 | 能压 Kafka/AI | 会把真正的 `lib/` 主干打成可选 |
| 机器可检 | orch4 ≈ 用法1 | orch4 仍 0 幻觉，但 **故事错了照样过闸** |

用法5 追用法1 的前提是：**仓库长得像「有前端、有 API、有 worker 的应用」**。对网关、代理、通知总线、无 SPA 的后端，需要：空层不画、可达性识别动态入口、不要为了锚点覆盖去画 `test/assets`。

---

## 后续（2026-08-31）

上表是 **shape 改造前** 的基线（四仓 Δ **−1.7**）。正式验收见 **[SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md)**：orch4+shape 拼接四仓 Δ **+1.50**，产品按双引擎收口。
