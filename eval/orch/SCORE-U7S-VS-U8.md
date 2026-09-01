# 用法7s 是不是用法8？分析与复测报告

日期：2026-08-31（验收收口：双引擎 A）  
复测：`npm test` 19/19；`verify-sweep.js` 五仓 structureGates after=0。  
edge 正式验收：[SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md)

---

## 一句话结论

**7s ≠ 用法8 全文；产品按双引擎收口，不对外叫用法8。**

- **7s** =「7 画 + 5 质检」在 **Web 五仓**上的落地；五仓已追平/略超用法1（8.00 vs 7.60）。  
- **形态 / 动态入口 / edge 验收**做在 **orch4+shape**，不是 7s。edge 四仓拼接 Δ **+1.50**，PLAN §1 三条 **均过**。  
- **不补** explore JSON / orch8。对外只讲 Generate + 精修；内部 Web→7s、edge→orch4。

---

## 流水线对照

| 环节 | 用法8 方案（PLAN-USAGE8） | **用法7s** | 用法5 orch4（2026-08-31） |
|------|--------------------------|-----------|---------------------------|
| 形态识别 `web/bridge/proxy/notify-bus/…` | P0 必做 | **无** | **有** `shape` + `emptyLayers` |
| 动态入口（index.js→TS、main.rs） | P0 必做 | 靠 dsh grep 碰巧能找到 | **有**（z2m `index.js`→`dist/`、RS/Go 入口） |
| Agent 探索契约 JSON | P1 | **无 JSON**；dsh 直接写 mermaid | **仍无** `state.explore` |
| 谁起草 mermaid | orch 受 explore 约束 | **dsh 自己写图** | orch4 受 **shape** 约束（非 explore JSON） |
| 路径闸门打回 | 要 | **有** `usage7-gated.js` | factcheck 在流水线内 |
| 结构/视觉闸门 | 要 | **有** | **有**（ext_* / actor-self / push-cycle） |
| 确定性扫尾 | 要 | `usage7-sweep.js` | `deterministicSweep` |
| 空层不画 | 形态规则强制 | dsh 可自发不画 | shape 禁令进 plan |
| 验收含 edge 四仓 | **必须** | 7s 产物不是主力 | 机评清零；盲评拼接 Δ **+1.50**（见验收页） |

用法8 原话：

> 探索可以猜，落盘必须过闸；闸门不能否决探索给出的「产品形态」。

7s 做到了前半句（猜完过闸）。**后半句没有：** 没有「产品形态」对象可被闸门尊重或否决；扫尾仍按 Web 七层秩（frontend→…→ops）剪边、归位 tracker。

---

## 为何看起来「就是用法8」

用法8 的拼法是「7 的大脑 + 5 的尺子和清洁工」。7s **正好是这条拼法在 Web 五仓上的实现**：

```
dsh 自主读仓写图  →  lintBlockDiagram 假路径打回  →  usage7-sweep 机械修复
```

五仓结果与用法8 的 **Web 仓目标**一致：

| 口径 | 用法8 当时目标 | 用法7s 实测 |
|------|----------------|-------------|
| 五仓幻觉 | 0 | **0** |
| 五仓结构 high | 0 | **0** |
| 五仓盲评 vs 用法1 | ≥ 8.2（相对当时 8.0） | 绝对盲评 **8.00** vs 同场用法1 **7.60**（噪声带内追平/略超） |

所以在 **「常规 Web 应用、打败/追平 Cursor」** 这一条上，7s **已经兑现用法8 的核心赌注**，不必再开一条平行的 orch8 起草线。

---

## 为何还不能叫用法8

7s 仍是「7 起草」，没有 explore JSON，也没有改掉用法5 当初在 edge 上翻车的那些**假设**——那些假设后来是 **orch4 自己改掉的**，不是 7s 改的。

| 用法8 要改掉的假设 | 7s | orch4 现况 |
|--------------------|----|------------|
| 默认 7 层 | 扫尾 `RANK` 仍七层 | shape + emptyLayers 进 plan |
| 静态 import 追入口 | 不跑 orch 取证 | 动态入口包已接 |
| Broker=人角色 | 未改 7s 白名单 | `ext_*` 系统对端合法 |
| 验收 edge Δ≥−0.5 | 7s 不是主力路径 | **已过**（Δ +1.50，见 [SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md)） |

用法8 的 P2 原文是 **orch 按 explore JSON 起草**。现在是 **orch4 按 shape 起草**，7s **没有**第二画师。少一次冲突不是缺点，但和方案原文仍不等价，也还没有 `llm-generate` → orch8 产品入口。

---

## 复测记录（本机 2026-08-31）

```
npm test                     → 19/19 pass
node eval/orch/verify-sweep.js → 五仓 sweep 后无 high 级结构问题
usage7s 五仓产物               → 均存在（changedetection/listmonk/uptime-kuma/memos/umami）
usage7s edge 四仓             → 全部 MISSING
```

幽灵节点修复与 `run.js` 扫尾安全网属 **用法5 产品化路径**（`llm-generate`/orch4），与 7s 的 `usage7-sweep.js` 是两套扫尾；两边都要保持「不吞声明」。

---

## 复评轨迹（caddy + ntfy）

中间轮次（`actor_ntfy` 清零后、边方向修复前）：caddy Δ+2.33（3:0）；ntfy Δ−1.33（0:3，输在密度不是幻觉）。  
**终轮**（锚点配套 + 边方向硬规则 + 评委 rubric 纪律）见 [SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md)：ntfy **Δ+0.67（2:1）**，caddy **Δ+2.00（3:0）**。

密度缺口（`client/`、`cmd/`、`attachment/`）已进 `findAnchorsV2` / sibling companions，终稿图上有 CLI / SDK / 附件。`web/public` 未追（静态壳）。评委把真实路径判成臆造，不作为改图依据。

---

## 命名与收口（A. 双引擎）

| 对外怎么说 | 落地 |
|------------|------|
| 用户入口 | **默认 Generate** + **精修 = Cursor 或自动闸门扫尾**。不讲用法编号。 |
| 内部 | Web 五仓 **7s**；edge **orch4+shape** |
| 不要说 | 「7s 等于用法8」；也不再开 explore JSON / orch8 产品路径 |

**不再做：** ntfy 单仓继续堆闸门；评委分数反传改边。

**一句话：** 7s 兑现五仓「7 画 + 5 质检」；orch4+shape 兑现 edge 验收；双引擎就是产品，用法8 全文（单一入口）刻意不做。
