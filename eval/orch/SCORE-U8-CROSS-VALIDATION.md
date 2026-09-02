# 跨仓证伪 orch8：vaultwarden + zigbee2mqtt 复测

日期：2026-09-01
仓：vaultwarden（api-svc 同类/Rust） + zigbee2mqtt（bridge 形态，shapeDetect 已对）
脚本：`eval/orch/blind-a-vs-u8.js`（参数化版）
引擎：`DEEPSEEK_API_KEY=... node eval/orch/blind-a-vs-u8.js <repo>`

## 写死判定（事前写定，不改）

- 两仓盲均分 orch8 ≥ orch4 **且**机评无否决 → 扩 ntfy/caddy 剩仓

- vaultwarden 胜、z2m/caddy 持平或输 → **orch8 仅作 shape 低置信降级，不替换双引擎 A**

- 两仓都输或否决 → 收回"全面优于 A"，openim 当案例

## 一、vaultwarden（Rust Bitwarden 后端，api-svc 同类）

### 机评

| 管线    | 轮 | 幻觉    | sHigh | sMed | 节点 | 边  | 机评分 | 否决           |
| ----- | - | ----- | ----- | ---- | -- | -- | --- | ------------ |
| orch4 | 1 | 0     | **2** | 0    | 20 | 25 | 0   | VETO         |
| orch4 | 2 | 0     | 0     | 2    | 22 | 23 | 8   | —            |
| orch4 | 3 | **1** | 0     | 0    | 23 | 24 | 0   | VETO (hallu) |
| orch8 | 1 | 0     | **2** | 0    | 24 | 26 | 0   | VETO         |
| orch8 | 2 | 0     | 0     | 0    | 24 | 28 | 10  | —            |
| orch8 | 3 | 0     | 0     | 0    | 26 | 28 | 10  | —            |

均值：orch4 2.67，orch8 6.67。否决次数：orch4 **2/3**（sHigh+hallu），orch8 **1/3**（sHigh）。

orch4 幻觉：r3 生成了一条 lint 不可达的路径（幻觉路径数=1）。
orch8 sHigh **真根因（已修，不是** **`_pgsql`** **漏匹配）**：explore 已把 `ext_db_mysql_pgsql` 分成圆柱，但 api-svc **shape 默认模板仍注入 stadium** **`ext_db`（「外部数据库」）**，两套外部系统抢坑；LLM 把模板 `ext_db` 画成外部角色，触发 `actor-infra` + `actor-storage`。openim 没暴露是因为那仓没用 api-svc 默认 stadium DB 模板。

落地：有 `state.explore` 时跳过 shape 默认 ext；sweep 0b 把 stadium DB/中间件改圆柱归位。单测见 `test/orch-auto-engine.test.js`。

### 盲评

| 轮 | orch4 deliverable | orch8 deliverable | 胜者    |
| - | ----------------- | ----------------- | ----- |
| 1 | 8                 | **9**             | orch8 |
| 2 | 7                 | **9**             | orch8 |
| 3 | 8                 | **9**             | orch8 |

**盲评 orch8 3:0 全胜**。deliverable 均值 9.0 vs 7.67。7 维分项中 path\_truth/layer\_semantics/edge\_correctness 均领先 0.5\~2 分，explore 的 trunkStory 数据流约束对密码管理（登录/注册/加密/持久化/邮件/SMTP/推送中继）链路刻画更完整。

### 结论对 vaultwarden：orch8 盲评胜（机评优于 orch4 但也有 1/3 否决，不满足"机评无否决"强条件，但 orch4 否决更多）

## 二、zigbee2mqtt（bridge 形态，z2m）

**shape：** orch8 explore 判定 shape=bridge，与 orch4 shapeDetect 结论一致。此仓验证"在 shape 已经判对的情况下，多一次 explore + trunkStory 有没有伤害"。

### 机评

| 管线    | 轮 | 幻觉 | sHigh | sMed | 节点 | 边  | 机评分 | 否决 |
| ----- | - | -- | ----- | ---- | -- | -- | --- | -- |
| orch4 | 1 | 0  | 0     | 1    | 20 | 24 | 9   | —  |
| orch4 | 2 | 0  | 0     | 0    | 21 | 22 | 10  | —  |
| orch4 | 3 | 0  | 0     | 0    | 15 | 18 | 10  | —  |
| orch8 | 1 | 0  | 0     | 1    | 25 | 34 | 9   | —  |
| orch8 | 2 | 0  | 0     | 0    | 19 | 20 | 10  | —  |
| orch8 | 3 | 0  | 0     | 0    | 22 | 32 | 10  | —  |

两侧三轮均 **sHigh=0/0/0，幻觉 0/0/0，avgScore 9.67 = 9.67 完全打平**。explore 对 bridge 形态的外部系统（zigbee\_network、mqtt broker）分流无错误。

### 盲评

| 轮 | orch4 deliverable | orch8 deliverable | 胜者    |
| - | ----------------- | ----------------- | ----- |
| 1 | **8**             | 6                 | orch4 |
| 2 | **9**             | 7                 | orch4 |
| 3 | **8**             | 7                 | orch4 |

**盲评 orch4 3:0 全胜**。deliverable 均值 8.33 vs 6.67。评委原因：

- 图 A（orch4）简洁清晰，分层和边符合真实架构

- 图 B（orch8）节点更多，边冗余杂乱，分层有错误（事件总线归调度、前端扩展归前端层），存在直连外部组件的错误边

**根因**：explore 把"真外部对端 vs 驱动层中间接口"的界线在 bridge 形态下分得太粗。比如 z2m 的 zigbee 网络在 orch4 里被描述成「zigbee 驱动层接口」（storage/worker 内部接口或硬件驱动节点），但 explore 把它分到 externalSystems 成了 stadium 外部角色"zigbee network"，导致图 B 外部角色区冗余+边出现正确层内节点越过入口直连外部角色的错误——这些错误评委扣分最重。

## 三、整体对照判定表

| 维度                    | vaultwarden           | zigbee2mqtt    | 命中分支          |
| --------------------- | --------------------- | -------------- | ------------- |
| 盲均分 orch8 ≥ orch4     | ✅ 9.0 vs 7.67         | ❌ 6.67 vs 8.33 | 条件 a（两仓都达）不满足 |
| 机评无否决                 | ❌ orch8 有 1/3 sHigh=2 | ✅ 两侧 0         | 条件 a 不满足      |
| vw 胜 + z2m/caddy 持平或负 | ✅                     | ✅（盲评负、机评平）     | **命中分支 b**    |

## 最终结论（按写死判定分支 b，不改）

> **orch8 仅作为 shape 低置信降级方案使用，不作为默认引擎替换双引擎 A。**

含义：

1. 默认走 orch4（双引擎A + 确定性 shapeDetect），除非 shapeDetect 的**置信度信号**（多层候选 / 打分接近 / 命中 notify-bus×api-svc 已知误判模式）偏低，此时切换 orch8 兜底；
2. openim 和 vaultwarden 上 orch8 表现好是真实信号，即：**微服务/密码/IM 类「多入口 + 强分层 + 多中间件」的 api-svc 形态**、且 shapeDetect 有不确定时，orch8 值得开；
3. bridge/代理类（z2m/caddy 类，shapeDetect 很稳）的仓 orch8 的 explore 外部系统叙事反而拖累图质量，一律默认 orch4；
4. "全面优于 A" 的说法收回，改为"形态不确定仓的强降级方案"；
5. 已验证 L1（7s 12:0）对 edge 的交付路径仍完全有效，本次判定只改"双引擎A vs U8 默认"的选择，不改 7s 作为 edge 默认路径的结论。

## 后续项（三项已落地，2026-09-01）

- [x] **vw 否决**：有 explore 时跳过 shape 默认 ext；sweep 0b 把 stadium DB 改圆柱。真根因是模板抢坑，不是 INFRA\_RE 漏 `_pgsql`

- [x] **bridge 注入**：mqtt/broker/zigbee/network 降为圆柱 + optional；取消固定 `ext_broker`/`ext_device` 强制出场（有 explore 时）

- [x] **auto 入口**：`chooseOrchEngine` — 高置信或 bridge 满分强信号 → orch4；其余及已知歧义（api-svc↔notify-bus、notify-bus↔web）→ orch8。CLI / `--refine` 默认 `auto`。单测 `test/orch-auto-engine.test.js`

**仍不做：** 用 orch8 替换双引擎 A；不改 L1（edge 上 7s 盲评 12:0）。不把 7s 闸门修复绑进本闭环。

## z2m orch8 复测（2026-09-02，当前代码）

见 [`SCORE-Z2M-ORCH8-RETEST.md`](./SCORE-Z2M-ORCH8-RETEST.md)。机评两侧 10 分零否决；盲评 orch8 **8.33 vs 7.33（2:1）→ 追回**。auto 规则不改（分支 b：强协议仓仍 orch4）。

## caddy orch8 复测（2026-09-02，当前代码）

见 [`SCORE-CADDY-ORCH8-RETEST.md`](./SCORE-CADDY-ORCH8-RETEST.md)。机评两侧 10 分零否决；盲评 orch4 **7.67 vs 7.33（2:1）→ 仍输**。proxy 不追回；auto 继续 `strongProtocolShape` → orch4。

## 产物

- vaultwarden：`/tmp/arch-orch/out/blind-u8-vaultwarden/summary.json`

- zigbee2mqtt：`/tmp/arch-orch/out/blind-u8-zigbee2mqtt/summary.json`

- 单轮产物：`/tmp/arch-orch/out/{orch4,orch8}-{vaultwarden,zigbee2mqtt}-r{1,2,3}/block-diagram.md`

