# 实战评分体系：双引擎 vs 用法1

日期：2026-08-31  
目的：回答「评测定义的打败用法1」是否经**统一实战**，而不是历史分拼接。

## 0. 先钉事实：此前「完成」算不算实战？

| 证据类型 | 此前有没有 | 缺口 |
|----------|------------|------|
| 机评（幻觉/结构 high） | 有，但分批脚本 | 未在同一 runner、同一代码 SHA 下九仓齐打 |
| 盲评（DeepSeek A/B） | 有 | **拼接**：z2m/vw = p1shape 批次；ntfy/caddy = 终轮；五仓 7s 另场 |
| 产物世代 | 混杂 | edge orch4 的 z2m/vw mtime 早于边方向终轮；7s edge 有产物但验收未用 |
| 产品入口 | 未测 | Web/CLI 默认 Generate ≠ 评测引擎 |

**结论（战役前）：** 此前 §1 数字**方向可信**，但**不是**「同一战役」完整实战。  
**结论（本页 §7 之后）：** 已用统一规则完成机评 + 3 轮盲评实战；见 §7.3。

## 1. 对战双方（双引擎冠军）

| 仓集合 | 「用法8 侧」冠军 | 对手 |
|--------|------------------|------|
| Web 五仓 | **usage7s** | usage1 |
| Edge 四仓 | **orch4+shape**（优先 `edge-p1shape/orch4/`） | usage1 |
| 对照列 | orch4（Web）/ usage7s（Edge） | 看非冠军引擎是否也过线 |

## 2. 机评分（A 档 · 可脚本 · 无 LLM）

每仓 × 每变体打一张卡：

| 指标 | 过线 | 权重 | 来源 |
|------|------|------|------|
| **hallu** 幻觉路径 | = 0 | 硬闸 | `lintBlockDiagram` |
| **structHigh** 结构 hard | = 0 | 硬闸 | `structureGates` |
| **visualHigh** 视觉 hard | = 0 | 硬闸 | `visualGates` |
| **layerErr** 层错 | ≤ 2（允许启发式噪声） | 软 | `layerGate` |
| **anchorCov** 锚点覆盖 | ≥ 0.8 或 missing=0 | 软 | `coverageGate` |
| **closeup** 子图2 | true | 软 | mermaid 块数 ≥ 2 |
| **notifyRev** 推送反边 | = 0 | 硬（notify-bus） | `notifyDirectionGate` |

**仓级机评判定：** 硬闸全过 → `PASS_HARD`；硬闸过且软项全过 → `PASS_FULL`；否则 `FAIL`。

**集合机评判定（对应 PLAN §1.1）：**

- Web 五仓冠军：全部 `PASS_HARD`
- Edge 四仓冠军：全部 `PASS_HARD`
- 用法1：报告其 FAIL 项（不要求用法1 过硬闸；历史已知有结构误伤）

## 3. 盲评分（B 档 · 需 LLM · 实战战役）

规则（与既有 blind 脚本对齐）：

- 同批 DeepSeek、匿名 A/B、每仓 **3 轮**
- 主指标：`deliverable` 均值
- 辅指标：path_truth / edge_correctness / density
- **禁止**跨批次拼接写进「战役总分」；历史分只能进「对照栏」

**集合盲评判定（对应 PLAN §1.2 / §1.3）：**

| 条件 | 过线 |
|------|------|
| Web 五仓 | 冠军交付均值 ≥ 用法1 |
| Edge 四仓 | 冠军相对用法1 的 Δ ≥ −0.5 |
| 稳定性 | 每仓 3 轮交付均值 ≥ 用法1（允许 1 轮输，但均值不过线） |

## 4. 战役总分公式

```
战役结论 =
  机评集合全部 PASS_HARD
  AND（盲评已跑：§1.2+§1.3 过线 | 盲评未跑：标「机评实战通过 / 盲评待战役」）
```

**不得**仅用历史盲评宣称「本战役盲评通过」。

## 5. 产物路径约定

```
REPO_ROOT=/tmp/arch-orch/repos
OUT=/tmp/arch-orch/out

usage1:     OUT/usage1-<short>/block-diagram.md
usage7s:    OUT/usage7s-<short>/block-diagram.md
orch4 web:  OUT/orch4/<repo>/block-diagram.md
orch4 edge: OUT/edge-p1shape/orch4/<repo>/block-diagram.md   # 优先
```

`<short>`：`changedetection.io` → `changedetection`。

## 6. 怎么跑

```bash
# 机评实战（无 Key）
node eval/orch/combat-score.js --json /tmp/arch-orch/out/combat-score.json --md eval/orch/SCORE-COMBAT.md

# 盲评战役（需 DEEPSEEK_API_KEY；对现有冠军产物，不重生图）
for r in 1 2 3; do node eval/orch/blind-combat.js --round $r; done
node eval/orch/blind-combat.js --aggregate
# 产物: /tmp/arch-orch/out/blind-combat/{round-*.json,summary.json}
```

## 7. 本机战役记录

### 7.1 机评实战（§1.1）

生成时间：2026-08-31T11:09:23.919Z · runner=`combat-score.js`

| 集合 | 冠军 | PASS_HARD | PASS_FULL | §1.1 |
|------|------|:---------:|:---------:|------|
| Web 五仓 | usage7s | ✅ | ❌（4/5 软项） | **PASS** |
| Edge 四仓 | orch4 | ✅ | ✅ | **PASS** |

逐仓硬闸：九仓冠军 hallu/structHigh/visualHigh 全为 **0/0/0**；用法1 在 Web 五仓全部 `FAIL`（主要为 visualHigh）。

### 7.2 盲评实战（§1.2 / §1.3）

生成时间：2026-08-31T11:12 左右 · runner=`blind-combat.js` · 3 轮 × 9 仓 · 匿名 A/B

| 集合 | 冠军均值 | 用法1均值 | Δ | 胜局（仓×轮） | §1.2 | §1.3 |
|------|--------:|--------:|----:|---------------|:----:|:----:|
| Web 五仓 | **8.80** | 6.80 | **+2.00** | 14:1:0 | ✅ | ✅ |
| Edge 四仓 | **8.58** | 7.00 | **+1.58** | 12:0:0 | ✅ | ✅ |

逐仓 deliverable 三轮均值（冠军 − 用法1）：

| 仓 | u1 | champ | Δ | 胜 |
|----|---:|------:|----:|----|
| changedetection | 7.67 | 8.67 | +1.00 | 2:1 |
| listmonk | 7.00 | 9.00 | +2.00 | 3:0 |
| uptime-kuma | 7.00 | 8.67 | +1.67 | 3:0 |
| memos | 6.33 | 8.67 | +2.33 | 3:0 |
| umami | 6.00 | 9.00 | +3.00 | 3:0 |
| caddy | 7.00 | 8.33 | +1.33 | 3:0 |
| ntfy | 7.33 | 8.33 | +1.00 | 3:0 |
| vaultwarden | 7.00 | 8.67 | +1.67 | 3:0 |
| zigbee2mqtt | 6.67 | 9.00 | +2.33 | 3:0 |

### 7.3 战役总结论

| 项 | 结果 |
|----|------|
| §1.1 机评 | **PASS** |
| §1.2 盲评集合 | **PASS** |
| §1.3 盲评稳定 | **PASS** |
| **战役结论** | **通过：双引擎拼装定义下，打败用法1 经本机统一实战成立** |

**仍须诚实标注：**

1. 本战役是**对既有产物打分**，不是「同 SHA 九仓重生图再评」；edge orch4 的 z2m/vw 生成早于 ntfy 终轮。
2. 冠军是**双引擎路由**（Web→7s，Edge→orch4），不是单一流水线。
3. 产品 Web/CLI 默认入口仍是骨架 Generate，≠ 本战役冠军引擎。
