# caddy orch8 复测（当前代码 · 3 轮机评 + 盲评）

日期：2026-09-02  
仓：caddy（proxy，shapeDetect 已对，margin=2）  
脚本：`eval/orch/blind-a-vs-u8.js`  
命令：

```bash
DEEPSEEK_API_KEY=... node lib/orch/run.js /tmp/arch-orch/repos/caddy orch8 /tmp/arch-orch/out/orch8-caddy-b2-rN
DEEPSEEK_API_KEY=... node lib/orch/run.js /tmp/arch-orch/repos/caddy orch4 /tmp/arch-orch/out/orch4-caddy-b2-rN
DEEPSEEK_API_KEY=... node eval/orch/blind-a-vs-u8.js caddy \
  /tmp/arch-orch/repos/caddy orch4-caddy-b2 orch8-caddy-b2 \
  /tmp/arch-orch/out/blind-caddy-b2
```

前置：auto 因 `strongProtocolShape=proxy` 走 orch4。z2m 同口径复测已追回（8.33 vs 7.33）。  
本场问：proxy 仓 orch8 是否也能追回。

explore：shape=proxy，extSystems=`ext_upstream` / `ext_acme_ca`（真外部对端，stadium 合理）。

---

## 裁决（先给）

**仍输。** 机评两侧全绿打平；盲评 orch4 **7.67 vs 7.33（2:1）**。

orch8 能赢单轮（r2 deliverable 9），均值落后 0.34，方差更大（1.56 vs 0.22）。  
**auto 不改**：caddy 继续 `strongProtocolShape` → orch4。

---

## 写死判定（事前，与 z2m 同表）

| 结果 | 条件 | 动作 |
|------|------|------|
| **仍输** | **盲均分 orch8 < orch4** | **分支 b 更稳；proxy auto 继续 orch4** |
| 追回 | 盲均分 orch8 ≥ orch4，且两侧机评无否决 | 记下：proxy 仓 explore 有增益；不自动改 auto |

本场命中 **仍输**。

---

## 机评

| 管线 | r1 | r2 | r3 | 幻觉 | sHigh | 否决 | 均分 |
|------|----|----|----|------|-------|------|------|
| orch4 | 10 | 10 | 10 | 0/0/0 | 0/0/0 | 无 | **10.00** |
| orch8 | 10 | 10 | 10 | 0/0/0 | 0/0/0 | 无 | **10.00** |

节点/边均值：orch4 24.0 / 23.0；orch8 22.7 / 21.7。

---

## 盲评（3 轮匿名 A/B）

| 轮 | orch4 | orch8 | 胜者 | 评委要点 |
|----|------:|------:|------|----------|
| 1 | **8** | 6 | orch4 | orch8：缺 worker/schedule；`main_entry` 直连存储/上游 |
| 2 | 7 | **9** | orch8 | orch8 路径覆盖、分层、边、命名全面领先 |
| 3 | **8** | 7 | orch4 | orch8 多余存储层、边方向错 |
| **集合** | **7.67** | **7.33** | **2:1** | Δ(orch8−orch4)=**−0.34** |

orch8 方差 1.56：能出 9 分也能出 6 分。orch4 稳定在 7–8。

---

## 与 z2m 对照

| 仓 | 形态 | 盲评 orch8 vs orch4 | 裁决 |
|----|------|---------------------|------|
| zigbee2mqtt | bridge score=10 | 8.33 vs 7.33（2:1） | **追回** |
| **caddy** | **proxy score=9, margin=2** | **7.33 vs 7.67（1:2）** | **仍输** |

两仓机评都是 10 分零否决。盲评上：bridge 注入修完后 orch8 能赢；proxy 上 explore 无形态纠正收益（shapeDetect 已判 proxy），trunkStory 不稳定，评委更吃 orch4 的规整度。

---

## 对 auto / 分支 b 的含义

1. **proxy 不追回**：`chooseOrchEngine` 的 `strongProtocolShape`（proxy|bridge → orch4）对 caddy 仍然正确。
2. **z2m 追回不外推**：桥接仓 explore 修注入后有故事收益；反向代理仓 shape 已对，多一次 explore 不保证可交付分。
3. **分支 b 不改**：orch8 只作低置信 / 已知歧义降级，不替换双引擎 A。
4. **L1 不动**。

## 产物

- 汇总：`/tmp/arch-orch/out/blind-caddy-b2/{machine-eval,blind-eval,summary}.json`
- 单轮：`/tmp/arch-orch/out/{orch4,orch8}-caddy-b2-r{1,2,3}/block-diagram.md`
