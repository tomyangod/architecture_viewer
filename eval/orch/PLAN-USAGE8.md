# 用法8 方案：Harness 探索 + orch4 闸门（目标击败用法1）

日期：2026-08-30  
依据：五仓 orch4 盲评 Δ−0.4；edge 四仓 Δ−1.7；用法7+路径闸门交付 8.3 / 幻觉 0。

## 1. 评估结论

**有可能。** 不是再堆同类闸门，而是把两边的不对称优势拼成一条流水线：

| 来源 | 贡献给用法8 | 单独不够的原因 |
|------|-------------|----------------|
| **用法5 orch4** | 路径/结构/命名确定性闸门、plan→draft→critic、扫尾、业务化命名 | edge 仓被「Web 七层 + 静态 import 可达性」打穿；过闸 ≠ 故事对 |
| **用法7 dsh** | 开放式读仓（grep/动态入口）、产品自述、空层不画的自由叙事 | 无硬闸门时幻觉；有闸门后仍略逊用法1 的叙事克制 |
| **用法1** | 故事主干、克制密度、对非应用型仓的形态判断 | 机评层错/结构 hard 仍有；不可规模化复现 |

**「打败用法1」的可操作定义（建议验收）：**

1. **机评**：五仓 + edge 四仓 幻觉=0、结构 high=0（允许少量 layerGate 噪声）  
2. **盲评**：同批 DeepSeek 评委，五仓交付均分 **≥ 用法1**；edge 四仓 Δ **≥ −0.5**（相对用法1）  
3. **稳定性**：同一仓连跑 3 次盲评，用法8 均分不低于用法1  

当前单靠用法5 或用法7 **都打不穿** edge 验收；合练是合理下一跳。继续只加 Web 仓扫尾规则，边际收益已低（报告已写明）。

**2026-08-31：** §1 三条已过，见 [SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md)。产品按 **双引擎** 收口（Web→7s，edge→orch4+shape），不补 P1 explore JSON。

## 2. 用法8 架构（一句话）

```
形态识别 → dsh/Agent 探索出「入口+主干故事+禁画清单」
        → orch4 计划/起草（受故事约束，空层不画）
        → 确定性闸门 + 扫尾（路径/幽灵边/跳级边/命名）
        → （可选）Agent 终审只改叙事，不得引入假路径
```

**硬原则：探索可以猜，落盘必须过闸；闸门不能否决探索给出的「产品形态」。**

## 3. 相对用法5/7 必须改掉的假设

| 旧假设（用法5 痛点） | 用法8 新规则 |
|----------------------|--------------|
| 默认 7 层 Web 应用 | **形态枚举**：`web-app` / `bridge` / `proxy` / `notify-bus` / `backend-only` / `unknown`；空层不画 |
| 静态 import 追入口 | **动态入口包**：`require(./x)`、`index.js`→TS、`main.rs`、`cmd/`、package.json `main/bin` |
| 不可达 = 旁路 | **旁路需双证据**：不可达 **且** 命中 optional 关键词 / 在 test 下；禁止 `test/assets` 当地锚点 |
| Broker/上游站 = 人角色 | **外部系统** stadium，允许 `mqtt→Broker`；结构闸门白名单扩展 |
| 锚点必须画满 | 锚点分 **trunk / optional**；optional 不上 mustEdges |
| dsh 自检即通过 | 落盘后 **同一套** `lintBlockDiagram` + structureGates；失败打回 |

## 4. 流水线分阶段（可并行开发）

### P0 — 形态 + 动态入口（1 周）· 专打 edge

- `lib/shape.js`（或 orch `shapeDetect`）：读 README 首屏 + 目录指纹 → 形态 + 默认层集合  
- 入口扩展：package.json bin/main、根 `index.js`、`cmd/*/main.go`、`src/main.rs`、动态 require 启发式  
- 重要性取证：从**真实入口集合** BFS；追不到时 **降级为「目录热度」而非整树旁路**  
- 验收：zigbee2mqtt `lib/controller` 不得标「可选」；caddy 不得用 `templates` 当 frontend 锚点  

### P1 — Agent 探索契约（3–5 天）· 接用法7

- 固定 JSON 产出（非自由 md）：

```json
{
  "shape": "bridge",
  "trunkStory": ["角色", "入口文件", "核心处理", "外部系统", "存储"],
  "mustPaths": ["..."],
  "forbidAsFrontend": ["test/assets", "templates"],
  "emptyLayers": ["frontend", "schedule"],
  "externalSystems": [{"id": "mqtt_broker", "name": "MQTT Broker"}]
}
```

- 实现：优先 **复用 dsh headless**（已有 session）；无 dsh 时用 DeepSeek + tools 子集（read/bash）  
- 契约经 schema 校验后写入 `state.explore`，**覆盖** orch4 错误的 detachedList  

### P2 — orch4 受故事约束起草（3–5 天）· 接用法5

- `plan` 的 layers ⊆ 形态允许层；`emptyLayers` 禁止出现 subgraph  
- `mustEdges` 必须覆盖 `trunkStory`；optional 路径不得进 mustEdges  
- 保留现有：路径闸门、命名、扫尾、子图2 短 id  
- `lib/llm-generate.js` 的 block 路径切到 `orch8`（或 `orch4 --explore`）  

### P3 — 终审与评测（3–5 天）

- 可选一轮 dsh：**只**根据评委式 checklist 改中文名/删密节点，**禁止**新增假路径（写后立刻 lint）  
- 评测矩阵：原五仓 + edge 四仓；脚本 `eval/orch/blind-u1-u8.js`  
- 成功标准见 §1  

## 5. 为何这能「打败」用法1（机制）

用法1 赢在 **故事**；输在 **不可复现的机评瑕疵** 与 **成本**。  
用法8 目标：

- 故事：交给 Agent 探索（用法7 强项）→ 对齐用法1  
- 事实：交给 orch 闸门（用法5 强项）→ **稳定反超**用法1 机评  
- 形态：显式 shape → 堵住 edge −1.7  

预期区间（先验，需盲评验证）：

| 集合 | 用法1 | 用法8 目标 |
|------|------:|-----------:|
| Web 五仓盲评 | 8.0 | **≥ 8.2** |
| Edge 四仓盲评 | 8.5 | **≥ 8.0**（Δ≥−0.5） |
| 机评幻觉/结构 hard | 有残留 | **双清零** |

## 6. 风险与不做的事

| 风险 | 缓解 |
|------|------|
| dsh + orch 双 LLM 贵且慢 | 探索只跑一次 JSON；起草仍 orch；缓存 `state.explore` |
| Agent 故事错导致闸门「保护错误主干」 | shape 低置信 → 人工/降级 orch4；forbid 列表可配置 |
| 继续优化 layerGate 误伤 | **不**把 layerGate 当交付主指标；盲评 + 幻觉才是主结论 |
| 为赢评委过度拟合五仓 | 验收 **必须含** edge 四仓 |

**不要做：** 再加一层只服务 Web 仓的扫尾；用评委分数反传改边方向（评委无仓库访问权）。

## 7. 里程碑与人力（粗估）

| 里程碑 | 产出 | 建议 |
|--------|------|------|
| M1 | shape + 动态入口；z2m/caddy 机评故事锚点正确 | 1 周 |
| M2 | explore JSON + orch 接入；五仓盲评 ≥ 用法1 | +1 周 |
| M3 | edge 四仓 Δ≥−0.5；默认 `llm-generate` 走用法8 | +3–5 天 |
| M4 | 文档：用法收束为「扩展一键 / 用法8 精修」 | 2 天 |

总日历约 **2.5–3.5 周**（单人熟悉 orch 代码）。

### 完成度（2026-08-31 终轮验收口径，对照 P0–P3）

| 里程碑 | 计划内容 | 终态 | 落在哪 |
|--------|----------|------|--------|
| **P0** | 形态枚举 + 动态入口 + 旁路双证据 | **完成** | [lib.js](./lib.js)：`shapeDetect`（web/bridge/proxy/notify-bus/api-svc）+ `emptyLayers`；动态入口（`index.js`→TS 桥接、`main.rs`、`cmd/`、package.json bin/main）；`ext_*` 系统对端合法、optional 需双证据；CLI/client 锚点 + sibling 配套 |
| **P1** | Agent explore JSON 契约（`state.explore`） | **刻意不做** | 双引擎 A：形态由 shapeDetect 确定性产出，不引入 explore JSON；7s 仍是 dsh 直接画 mermaid |
| **P2** | orch 受 explore 约束起草；`llm-generate` → orch8 | **部分（shape 替代 explore）** | orch4 已接 shape/emptyLayers/ext_*/边方向硬规则（actor→entry 禁区、推送边精确豁免、通道入站归 API 层、断头检查）；无 explore 覆盖、无 orch8 产品入口（刻意） |
| **P3** | 终审 + 五仓 + edge 盲评验收 | **完成** | 五仓 7s：盲评 8.00 vs 用法1 7.60；edge 四仓：机评幻觉/结构 high **双零**，盲评拼接 Δ **+1.50**、orch4 **11:1**（z2m +2.00 3:0、vw +1.33 3:0、caddy +2.00 3:0、ntfy +0.67 2:1）。**ntfy 为边方向+入站归层终轮代码重跑产物**（非 p1shape 旧图）；caddy 为边方向规则批次产物（后续 ext_db/入站归层改动仅影响 notify-bus/api-svc 形态，proxy 不受影响）；ntfy 终稿 edge 8.67 vs 用法1 8.00 |

§1 三条验收（机评双零 / 盲评 Δ≥−0.5 / 三轮均分不低于用法1）**全部通过**，正式归档见 [SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md)。

## 8. 产品叙事（用法收束 · 已按 A 落地）

对外不再并列 8 种入口，只保留：

1. **默认**：扩展/CLI Generate（规则）  
2. **精修**：Cursor Chat **或** 自动闸门扫尾（内部：Web 走 7s，edge 走 orch4+shape）  
3. **进阶**：网页分享 / CI check  

用法5/7 是内部引擎，不单独对用户讲。**不对外使用「用法8」这个名字。**

## 9. Go / No-Go

| 条件 | 建议 |
|------|------|
| 要规模化、要打 edge、要宣传「自动接近 Cursor」 | **Go：做用法8** |
| 只服务 Web CRUD 仓 | No-Go；维持 orch4 即可（已 −0.4） |
| 没有 DeepSeek Key / 不愿依赖 dsh | Go 变体：探索阶段用本机 tool-loop，不绑 dsh 二进制 |

**落地对照（2026-08-31 验收）：** [SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md) · [SCORE-U7S-VS-U8.md](./SCORE-U7S-VS-U8.md)

产品决定 **A. 双引擎**（不补 explore JSON / orch8）：

- **Web 五仓 → 7s**（「7 画 + 5 质检」）；盲评 8.00 vs 用法1 7.60。
- **edge 四仓 → orch4+shape**；机评清零；盲评拼接 Δ **+1.50**（ntfy +0.67 2:1，caddy +2.00 3:0，z2m +2.00，vw +1.33）。
- **§1 三条验收均过。** ntfy 1/3 轮噪声不挡验收，不再堆单仓闸门。
- 对外不叫「用法8」；5/7 是内部引擎。

**一句话：** 用法8 的核心分工（认清形态 + 不许写假的）已在双引擎上兑现；全文（explore JSON、单一 orch8 入口）**刻意不做**。
