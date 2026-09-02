# L1 路由消融：edge 四仓 · 7s vs orch4+shape（同场）

日期：2026-09-01  
战役：同 SHA 重生四仓产物 → 机评消融 → 3 轮同批评委盲评  
脚本：`blind-edge-7s-vs-orch4.js` · `ablation-score.js`  
产物：`/tmp/arch-orch/out/edge-l1/orch4/` · `/tmp/arch-orch/out/usage7s-{ntfy,vaultwarden,zigbee2mqtt,caddy}/`  
汇总：`/tmp/arch-orch/out/blind-edge-7s-vs-orch4/summary.json`

**不做 U8。** 本战役只回答：edge 上「冠军路由 orch4+shape」是否仍优于「走错路的 7s」。

---

## 一句话

**盲评：7s 完胜 orch4（12:0，deliverable 9.00 vs 7.00，Δ(orch4−7s)=−2.00）→ 分流表「edge→orch4」在交付观感上被质疑。**  
**机评：orch4 四仓硬闸全过（0/0/0）；7s 四仓全部 FAIL（structHigh 1–5）→ 分流在机评上仍偏向 orch4。**

这是典型的「过闸 ≠ 故事好看」分裂，和早期 SCORE-EDGE-U7S 的方向一致，但幅度更大（当时 7s 仍输用法1；本场 7s 直接碾压现 orch4）。

---

## 1. 机评消融（hallu / structHigh / visualHigh）

| 仓 | orch4（A 冠军） | 7s（走错路） | 路由是否「帮」机评 |
|----|----------------|--------------|-------------------|
| ntfy | **0/0/0 PASS_HARD** | 0/1/0 FAIL | helps orch4 |
| vaultwarden | **0/0/0 PASS_HARD** | 0/1/0 FAIL | helps orch4 |
| zigbee2mqtt | **0/0/0 PASS_HARD** | 0/5/0 FAIL | helps orch4 |
| caddy | **0/0/0 PASS_HARD** | 0/2/0 FAIL | helps orch4 |

7s 的 structHigh 主要来自可达性/旁路启发式误伤（z2m 尤甚），不是幻觉路径（hallu 两边都是 0）。

---

## 2. 盲评（3 轮 × 4 仓，匿名 A/B）

| 仓 | 7s 均值 | orch4 均值 | Δ(orch4−7s) | 胜局 |
|----|--------:|----------:|------------:|------|
| caddy | **9.00** | 6.67 | **−2.33** | 3:0 |
| ntfy | **9.00** | 7.00 | **−2.00** | 3:0 |
| vaultwarden | **9.00** | 7.00 | **−2.00** | 3:0 |
| zigbee2mqtt | **9.00** | 7.33 | **−1.67** | 3:0 |
| **集合** | **9.00** | **7.00** | **−2.00** | **12:0:0** |

判定规则（预写）：Δ(orch4−7s) ≥ +0.3 → 维持 edge→orch4；≤ −0.3 → **重审分流**；\|Δ\|<0.3 → 噪声带。

**VERDICT：`ROUTING_QUESTIONED_7S_WINS`**

---

## 3. 对双引擎 A 的含义

| 维度 | 谁赢 | 产品含义 |
|------|------|----------|
| 机评硬闸 | orch4 | 若产品 KPI 是「幻觉/结构硬伤清零」，edge 仍应走 orch4 |
| 盲评交付 | **7s** | 若产品 KPI 是「给老板/团队可交付图」，edge **不应再死绑 orch4** |
| 历史 SCORE-EDGE-ACCEPT | orch4 vs 用法1 Δ+1.50 | 那是「orch4 打用法1」，**不是**「orch4 打 7s」；本战役补上了缺的对照 |

**建议（战役后，不自动改产品）：**

1. **重审 edge 分流**：候选方案 — edge 也走 7s，再用 orch4 的 structureGates 做软报告（不否决）；或 7s 画图 + orch4 扫尾（接近用法8 拼法，但无 explore JSON）。
2. **先修 7s 在 edge 的 structHigh 误伤**（可达性/旁路），再决定是否把 edge 冠军换成 7s。
3. **仍不实现 U8 全文**，除非修闸后仍需要 Agent 形态契约。

---

## 4. 产物世代（同战役）

| 管线 | 生成时间（本机） | 路径 |
|------|------------------|------|
| orch4+shape | 2026-09-01 22:25–22:27 | `out/edge-l1/orch4/<repo>/` |
| usage7s | 2026-09-01 22:29–22:46 | `out/usage7s-<short>/` |
| 盲评 | 2026-09-01 22:46–22:47 | `out/blind-edge-7s-vs-orch4/` |

四仓均同日同批重生；非历史拼接。

---

## 5. 怎么复跑

```bash
export DEEPSEEK_API_KEY=...
# orch4
for n in ntfy vaultwarden zigbee2mqtt caddy; do
  node eval/orch/run.js /tmp/arch-orch/repos/$n orch4 /tmp/arch-orch/out/edge-l1/orch4/$n
done
# 7s
HOME=/tmp/dsh-home DSH_BIN=... node eval/orch/usage7-gated.js ntfy vaultwarden zigbee2mqtt caddy
node eval/orch/usage7-sweep.js ntfy vaultwarden zigbee2mqtt caddy
# 评分
node eval/orch/ablation-score.js --json /tmp/arch-orch/out/ablation-score-l1.json
for r in 1 2 3; do node eval/orch/blind-edge-7s-vs-orch4.js --round $r; done
node eval/orch/blind-edge-7s-vs-orch4.js --aggregate
```
