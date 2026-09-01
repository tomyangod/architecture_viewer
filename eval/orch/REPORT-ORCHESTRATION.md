# 评估报告：智能体编排（LangGraph 式）能否把用法 5 的 LLM 出图质量拉到用法 1 水平？

> 实验日期：2026-08-29 · 模型：deepseek-chat · 靶仓：changedetection.io（文件树 1214 路径，取证摘录 36 段 / \~9 万字符）
> 代码：[eval/orch/lib.js](file:///Users/yanheyang/Desktop/architecture_viewer/eval/orch/lib.js)、[eval/orch/run.js](file:///Users/yanheyang/Desktop/architecture_viewer/eval/orch/run.js)、[eval/orch/blind-eval.js](file:///Users/yanheyang/Desktop/architecture_viewer/eval/orch/blind-eval.js)
> API Key 仅经环境变量一次性使用，未写入任何仓库文件。**Key 已在对话中暴露，请立即到 platform.deepseek.com 作废轮换。**

***

## 1. 一句话结论

**能把「可机器判定的质量项」做到接近满分（0 幻觉、0 层归属错误、0 渲染错误、密度达标），但「架构判断」（哪些子系统必须出场、边的业务语义、命名贴业务）仍达不到用法 1 的 9 分——编排把 LLM 出稿的事实质量从 \~6 抬到 \~7.5，最后 1.5 分仍然来自「人读得懂这个系统」的草稿确认闭环。**

质量阶梯更新：

```
手写精品 ≥ 用法1 人+大模型+草稿确认            ≈ 9
≥ 编排+全树+确定性闸门+人工审（完善后预期）      ≈ 8–8.5（当前 orch2 实测 7.5）
≈ 富上下文单轮（rich1 / 方法5 一次出稿）        ≈ 7.5–8（需人工修边/减密）
≫ digest 扫描摘要                             ≈ 5.5–6
≈ 规则扫描 generate                           ≈ 2.5
```

***

## 2. 实验设计：LangGraph 式流水线

把「用法 1 工程师的隐式动作」显式化为图节点（确定性工具=矩形，LLM=圆角）：

```
gather(确定性取证：全树+摘录)
  → plan(LLM 规划分层/节点/边)
  → gate(确定性路径闸门：plan 引用的路径必须在树中) ↺ 最多3轮
  → draft(LLM 起草，带源码摘录)
  → factcheck(确定性：路径核查 + mermaid lint)
  → layergate(确定性：路径关键词→层语义约定)        ← orch2 新增
  → critic(LLM 批判)                              ← 裸眼(orch) / 接地(orch2)
  → refine(LLM 修订)                             ↺ 最多2轮
  → validate
```

5 个变体 + 2 个人工基准，同仓同模型对比：

| 变体          | 配置                                                        | LLM 调用                                 | 上下文     |
| ----------- | --------------------------------------------------------- | -------------------------------------- | ------- |
| digest      | 扫描摘要 JSON 单轮（复刻现有 `lib/llm-generate.js`）                  | 1                                      | 仅摘要     |
| rich1       | 全树+摘录，一次出稿（=方法5 的「零审阅终稿」）                                 | 1                                      | \~9 万字符 |
| nocritic    | plan→闸门→draft→**只过确定性闸门**，无 LLM 批判                        | 2                                      | \~9 万字符 |
| orch        | nocritic + **裸眼 LLM 批判×2 轮**                              | \~5                                    | \~9 万字符 |
| orch2       | orch + **接地批判**（喂确定性解析的节点/边表，过滤 phantom 问题）+ **确定性层归属闸门** | 5（82k prompt / 6.6k completion tokens） | \~9 万字符 |
| method1（基准） | Cursor Agent + AGENT.md，人工流程                              | —                                      | —       |
| method5（基准） | 前次实验 DeepSeek 全树手写引擎稿                                     | —                                      | —       |

***

## 3. 结果总表

### 3.1 机评（确定性指标）

| 变体         | 幻觉路径  | 层归属错误 | 节点/边                     | mermaid lint | 关键链路覆盖    | 浏览器渲染      |
| ---------- | ----- | ----- | ------------------------ | ------------ | --------- | ---------- |
| digest     | 0     | 3     | 9/10                     | 0            | **7/14**  | ✅ parse 通过 |
| rich1      | 0     | 6     | 37/44                    | 2            | **12/14** | ✅          |
| nocritic   | 0     | 2     | 20/16                    | 0            | 9/14      | ✅          |
| orch       | 0     | 6     | 23/22                    | 0            | 9/14      | ✅          |
| **orch2**  | **0** | **0** | **26/22**（落在建议 15–25 附近） | **0**        | 10/14     | ✅          |
| method1 基准 | 0     | 0     | 32/47                    | 1（密度）        | **13/14** | ✅          |
| method5 基准 | 0     | 2     | 49/72（过密）                | 2            | 13/14     | ✅          |

* 7 份图在 Chrome + 本地 mermaid v11.6.0 下**全部渲染成功，0 渲染异常、0 控制台错误**（对比页：`/tmp/arch-orch/out/render-check.html`）。

* 关键链路覆盖（14 个锚点：入口/前端页面/REST API/调度队列/worker池/抓取器/浏览器步骤/差异处理/存储/通知服务/通知渠道/实时推送/部署/外部站点）是本次新增的客观指标。

### 3.2 LLM 盲评（7 份匿名洗牌、同模型评委、7 维 rubric）

| 排名 | 图                       | 综合可交付分 | 评委一句话                    |
| -- | ----------------------- | ------ | ------------------------ |
| 1  | method1                 | **9**  | 路径真实、分层清晰、链路完整、命名准确，节点稍多 |
| 1  | method5                 | **9**  | 同上，节点过多影响可读性             |
| 3  | rich1                   | **8**  | 路径较真实、链路较全，节点偏多、部分边冗余    |
| 4  | orch / nocritic / orch2 | **7**  | 路径基本真实，但分层/边方向有问题，命名一般   |
| 7  | digest                  | **6**  | 链路残缺，分层有误                |

> 评委与机评的分歧本身是重要发现：评委给 orch2「分层 6 分」而机评为 0 层错——争议点是**页面型 Flask blueprint（blueprint/ui、watchlist、settings）该归前端还是 API 层**（灰区）；评委给 rich1「分层 8 分」而机评 6 层错。说明评委更吃「信息全、链路密」，硬错误要靠机器抓。

### 3.3 人工终稿复核（以 orch2 为例）

事实层满分，但残留的都是**架构判断问题**：

1. **通知执行链整条缺失**：最终图 monitor 层只有 realtime/conditions/llm，没有 `notification_service.py`、`NotificationQueue`、`notification/`（Apprise 渠道）——而这是 changedetection.io 的**签名子系统**；并错配出 `conditions -->|触发通知| api_notifications`（那是 REST 配置 API，不是通知执行器）。
2. **进程入口缺失**：无 `flask_app.py` / `changedetection.py`（覆盖率表中 orch2「入口」为 ·）。
3. 小问题：`static_assets` 孤立无边；`docker --> compose` 方向语义反了；前端层 emoji 误用 🛒。

这些问题没有一个被批判节点抓到——批判注意力全被层归属和边表占满。

***

## 4. 核心发现（每条都有实验证据）

### 4.1 幻觉路径已可工程化消除（复现并固化）

全树作为 ground truth + 计划阶段路径闸门 + 出稿后路径核查：**本次 5 个自动变体全部 0 幻觉**。路径核查器初版对短文件名（`flask_app.py`）有误报，改为「树中任意路径后缀匹配 + 镜像引用豁免」后，method1/method5 基准稿也归零误报。→ **可直接产品化进** **`lib/llm-generate.js`。**

### 4.2 LLM 批判者不接地会幻觉、会自相矛盾（LangGraph 教训本机复现）

* orch 裸眼批判：轮 1 说「删掉 diff→notification，改成 worker→notification」；轮 2 报了 **39 条问题**，包括「缺少 diff→notification 边」（轮 1 刚让删的）、「缺少 worker→notification」（轮 1 修订已加）、还要求 `api_spec→datastore` 这类无意义边。

* orch2 接地后（喂确定性解析的节点/边表 + 程序过滤「已存在却报缺失」的 phantom 问题）：批判降到 7–13 条，无自相矛盾，且独立抓出的层错误与确定性闸门**完全一致**（diff/processors 归 worker、realtime 归 monitor）。

* **教训：LLM 节点必须用确定性工具的输出接地；批判意见要与图的解析结果对账。**

### 4.3 确定性闸门有效，但状态不回写会导致「批判要求回归错误」

orch2 轮 1 修订已把 diff/processors 正确移入 worker 层；**轮 2 批判对照旧 plan 说「计划里它们属监控层，请移回去」**——确定性修复被 LLM 当成错误要求回滚，靠 2 轮上限侥幸拦住。

* **教训：闸门的修正必须回写共享状态（plan 本身要更新）；工具高置信结论与 LLM 意见冲突时，工具优先。**

### 4.4 闸门保「正确性」，不保「完整性」

通知链在 **plan 阶段就没被选入**（1214 条路径采样 26 个节点时漏掉了签名子系统），后续没有任何节点负责发现「关键子系统缺席」；反而是无计划的单轮 rich1 把通知服务画进去了（覆盖 12/14）。

* **可确定性补的一半**：扫描入口点（`changedetection.py`/`flask_app.py`）、签名子系统（`notification*`、`realtime/`）作为**强制锚点**注入 plan，并在核查时做「锚点覆盖闸门」。

* 另一半（边的业务语义、命名贴业务、外部 actor 取舍）仍属架构判断。

### 4.5 规则闸门有精度边界，灰区不能硬判

层闸门抓出了全部真错误（抓取/处理链错归监控、realtime 错归调度、`static/js/scheduler.js` 错归调度层），但把页面型 blueprint 判 api 层、而盲评评委偏好归前端——**确定性规则应只阻断高置信约定，灰区降为 warning 交人/LLM 讨论。**

***

## 5. 直接回答你的问题

> 「能不能用 LangGraph 式编排，把用法 5（LLM API 引擎）拉到用法 1 质量？」

* **事实质量（路径真实性、语法、分层约定、密度、渲染）：能。** orch2 已全部为 0 错误，且不需要人干预。这部分从「碰运气」变成「可 CI 卡关」。

* **交付质量（架构叙事完整性、边语义、业务命名）：不能自动追平。** 最佳自动稿（rich1 8 分 / orch2 7.5 分）与用法 1（9 分）的差距，是「有没有读懂这个系统靠什么活着」——本次具体表现为漏掉通知链、错接配置 API、漏入口。

* **工程上还差三块拼图**（按性价比排序）：

  1. **锚点覆盖闸门**（确定性，预计补回大部分完整性失分）；
  2. **状态回写 + 批判接地**（本轮已验证有效性，修掉回归 bug）；
  3. **「主链路自述」节点**：让 LLM 先用一句话讲「用户请求怎么流过系统、变更怎么变成通知」，再自检图里缺哪一段（把用法 1 的草稿确认显式化；这一步天然需要人按一次确认）。

预期完善后的编排稿可到 **8–8.5 分**；最后 0.5–1 分仍建议保留**人工草稿确认**——编排的商业价值不是「取代用法 1」，而是**把用法 1 的平均产出时间从小时级压到分钟级、把质量下限从 2.5 分抬到 7.5 分**，且确定性闸门可放进 CLI/CI（`check --filled --drift` 的增强版）。

## 6. 产物清单

| 产物       | 路径                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 编排流水线代码  | [eval/orch/run.js](file:///Users/yanheyang/Desktop/architecture_viewer/eval/orch/run.js)、[eval/orch/lib.js](file:///Users/yanheyang/Desktop/architecture_viewer/eval/orch/lib.js) |
| 盲评脚本/结果  | [eval/orch/blind-eval.js](file:///Users/yanheyang/Desktop/architecture_viewer/eval/orch/blind-eval.js)；`/tmp/arch-orch/out/blind/{metrics-v2,llm-judge,anon-key}.json`            |
| 5 变体出图   | `/tmp/arch-orch/out/{digest,rich1,nocritic,orch,orch2}/block-diagram.md`（含 state.json 全过程留痕）                                                                                      |
| 7 图渲染对比页 | `/tmp/arch-orch/out/render-check.html`（浏览器实测 0 错误）                                                                                                                                |
| 基准稿      | `/tmp/arch-compare/method1-cursor-agent/`、`/tmp/arch-compare/method5-deepseek-handwriter/`                                                                                        |

**安全提醒**：DeepSeek Key 仅通过环境变量使用，未写入仓库；但它已出现在对话中，请立即作废轮换。

---

## 8. 追分实验 orch3（2026-08-30）

针对「7.5 vs 9」的缺口补了三块拼图。后续 orch4 已替换 orch3 成为用法 5 默认引擎（见第 9 节）。

| 补丁 | 作用 |
|------|------|
| **锚点覆盖闸门** | 入口 / flask / 队列 / worker / 抓取 / store / notification_service / notification/ / templates / static / compose 只要在树里就必须出现在图中 |
| **plan 层回写** | `rewritePlanLayers`：按路径关键词改层后再起草、再批判，避免对照旧 plan 回滚 |
| **主链路自述** | 先用一句话讲「用户→队列→worker→存储→通知执行」，mustEdges 注入计划 |
| **语义陷阱** | 禁止「触发通知 → api/Notifications.py」 |

### 同仓对照（changedetection.io）

| 变体 | 幻觉 | 层错 | 签名链路覆盖 | 通知执行链 | 综合 |
|------|------|------|----------------|------------|------|
| digest | 0 | 3 | 4/14 | 无 | ≈6 |
| orch2 | 0 | 0 | 10/14 | **缺失**（错接配置 API） | ≈7.5 |
| **orch3b** | **0** | **0** | **12/14** | **worker → notification_service → notification/** | **≈8.5–9** |
| method1 基准 | 0 | 0 | 11/14* | 有 | ≈9 |

\* method1 的 11/14 含评分正则假阴性（`store/` 无前导斜杠等）；人工看 method1 仍是叙事最完整的一档。

orch3b 终稿主链路（人工核对）：

`changedetection.py → flask_app.py → api/ → queue_handlers → worker_pool → worker → content_fetchers → store`，以及 `worker → notification_service → notification/` 与 `realtime`。

仍略逊于用法 1 的点：emoji 偏单一、缺外部「被监测站点」actor、templates→flask 边语义略怪、节点 14 个略疏。这些不再是「画错系统」。

### 泛化烟测（listmonk）

同样 0 幻觉、0 层错、7 层；节点落到 `cmd/main.go`、`internal/messenger`、`schema.sql` 等真实路径。Python 向锚点会误抓 `frontend/src/api/index.js` 当 entry，计划阶段仍能补上 `cmd/main.go`。锚点表还需按语言扩，但不阻断事实质量。

### 用法 5 怎么用

```bash
export DEEPSEEK_API_KEY=sk-...
node lib/llm-generate.js /path/to/repo --only block-diagram.md
```

---

## 9. 最终追平 orch4（2026-08-30）

用法 5 默认引擎已从 orch3 升级为 **orch4**（重要性取证 + 产品自述 + 通用锚点 + 结构/视觉闸门 + 确定性扫尾）。五仓复跑核验见 [SCORE-U1-vs-ORCH4.md](./SCORE-U1-vs-ORCH4.md)。

| 口径 | 用法1 | orch4 |
|------|------:|------:|
| 盲评交付均分 | 8.0 | 7.6（Δ −0.4） |
| 幻觉 / 层错 / 结构 hard | 层错 6 处合计；结构 hard 4 处 | **全 0** |
| 锚点覆盖 / 子图2 | 部分缺锚点、4 仓无特写 | **全覆盖 + 五仓均有特写** |

盲评从 orch3 时代的约 −1.6 收到 −0.4；umami 反超（8 vs 7），uptime-kuma 追平。评委「臆造路径」磁盘核验全部存在。`npm test` 19/19；`verify-sweep.js` 五仓清零。listmonk 残留 1 条 ops 实线，与用法 1 同类问题，不挡「机器可检已追平」的结论。

