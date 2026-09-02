# z2m orch8 复测（当前代码 · 3 轮机评 + 盲评）

日期：2026-09-02  
仓：zigbee2mqtt（bridge，shapeDetect 已对）  
脚本：`eval/orch/blind-a-vs-u8.js`  
命令：

```bash
DEEPSEEK_API_KEY=... node lib/orch/run.js /tmp/arch-orch/repos/zigbee2mqtt orch8 /tmp/arch-orch/out/orch8-z2m-b2-rN
DEEPSEEK_API_KEY=... node lib/orch/run.js /tmp/arch-orch/repos/zigbee2mqtt orch4 /tmp/arch-orch/out/orch4-z2m-b2-rN
DEEPSEEK_API_KEY=... node eval/orch/blind-a-vs-u8.js zigbee2mqtt \
  /tmp/arch-orch/repos/zigbee2mqtt orch4-z2m-b2 orch8-z2m-b2 \
  /tmp/arch-orch/out/blind-z2m-b2
```

前置：跨仓证伪盲评 orch4 3:0（6.67 vs 8.33）；第一次修注入后复测 orch4 2:1（7.67 vs 8.00）。  
本场：同 SHA、当前代码（explore 跳过 shape 模板 + `EXPLORE_BRIDGE_INFRA_RE` + sweep 0b）重生 3+3。

---

## 裁决（先给）

**追回。** 机评两侧全绿打平；盲评 orch8 **8.33 vs 7.33（2:1）**。

跨仓时的「bridge orch8 反伤」在本场消失。explore 不再把 MQTT/Zigbee 硬塞成 stadium 外部角色。

**auto 默认不改。** 分支 b 仍成立：orch8 只作 shape 低置信降级，不替换双引擎 A。z2m 是 strongTop bridge（score=10, margin=3），auto 继续走 orch4。一场追回不够把强协议仓默认切到 orch8。

---

## 写死判定（事前）

| 结果 | 条件 | 动作 |
|------|------|------|
| 仍输 | 盲均分 orch8 < orch4 | 分支 b 更稳；bridge auto 继续 orch4 |
| **追回** | **盲均分 orch8 ≥ orch4，且两侧机评无否决** | **记下：bridge 注入修法有效；不自动改 auto** |

本场命中 **追回**。

---

## 机评

| 管线 | r1 | r2 | r3 | 幻觉 | sHigh | 否决 | 均分 |
|------|----|----|----|------|-------|------|------|
| orch4 | 10 | 10 | 10 | 0/0/0 | 0/0/0 | 无 | **10.00** |
| orch8 | 10 | 10 | 10 | 0/0/0 | 0/0/0 | 无 | **10.00** |

节点/边均值：orch4 17.0 / 19.7；orch8 19.3 / 23.7。

---

## 盲评（3 轮匿名 A/B）

| 轮 | orch4 | orch8 | 胜者 | 评委要点 |
|----|------:|------:|------|----------|
| 1 | 7 | **9** | orch8 | orch4：API 层混入适配器、controller 直连外部设备；orch8 分层/边更完整 |
| 2 | **8** | 7 | orch4 | orch8 事件总线误归 API、缺扩展/日志 |
| 3 | 7 | **9** | orch8 | orch8 分层清晰、边与命名更贴真实桥接 |
| **集合** | **7.33** | **8.33** | **2:1** | Δ(orch8−orch4)=**+1.00** |

orch8 方差更高（0.89 vs 0.22）：r2 仍会漏模块。均值已翻盘。

---

## 与前两场对照

| 战役 | 代码 | 盲评 orch8 vs orch4 | 机评 |
|------|------|---------------------|------|
| 跨仓证伪 `blind-u8-zigbee2mqtt` | 注入未修 | 6.67 vs 8.33（0:3） | 两侧 9.67 打平 |
| 修注入后 `blind-z2m-retest` | 第一次修 | 7.67 vs 8.00（1:2） | orch8 10 / orch4 6.67（r2 幻觉） |
| **本场 `blind-z2m-b2`** | **当前码** | **8.33 vs 7.33（2:1）** | **两侧 10，零否决** |

趋势：反伤 → 噪声级落后 → 追回。

---

## 对 auto / 分支 b 的含义

1. **注入修法有效**：`EXPLORE_BRIDGE_INFRA_RE` + 有 explore 时跳过 shape 默认 `ext_broker`/`ext_device`，是本场翻盘的前提。
2. **分支 b 不改**：默认仍是双引擎 A；orch8 只在低置信 / 已知歧义（api-svc↔notify-bus、notify-bus↔web）降级。
3. **z2m auto 仍 orch4**：strongProtocolShape（bridge score=10）。本场证明「强信号仓上 orch8 不再必输」，不是「强信号仓应改走 orch8」。
4. **L1 不动**：edge 交付仍是 7s 观感 vs orch4 闸门那条线。

若要再动 auto，需另开战役（例如 caddy proxy margin=2 是否也能追回），本场不改 `chooseOrchEngine`。

## 产物

- 汇总：`/tmp/arch-orch/out/blind-z2m-b2/{machine-eval,blind-eval,summary}.json`
- 单轮：`/tmp/arch-orch/out/{orch4,orch8}-z2m-b2-r{1,2,3}/block-diagram.md`
