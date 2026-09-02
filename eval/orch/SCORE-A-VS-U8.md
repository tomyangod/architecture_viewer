# 双引擎 A vs 用法8 对比评测报告

日期：2026-09-01（修复后复测）
仓库：OpenIM（Go 微服务 IM 平台）
脚本：`eval/orch/blind-a-vs-u8.js`

## 一句话

**openim 单仓**：修复后 orch8 机评零否决、盲评 3:0，对本仓成立。  
**跨仓外推**：已证伪「全面优于双引擎 A」→ 见 `SCORE-U8-CROSS-VALIDATION.md`（分支 b：orch8 = shape 低置信降级，默认仍为双引擎 A）。

## Phase 1: 产物

| 管线         | 形态来源               | shape          | r1 | r2 | r3 |
| ---------- | ------------------ | -------------- | -- | -- | -- |
| orch4 (A)  | 确定性 shapeDetect    | notify-bus（误判） | ✅  | ✅  | ✅  |
| orch8 (U8) | Agent explore JSON | api-svc（正确）    | ✅  | ✅  | ✅  |

explore.json 由 dsh headless 一次产出（0 errors），15 条 mustPaths 全真实，6 个外部系统，7 条 trunkStory 覆盖完整数据流。

## 修复内容（orch8）

1. **externalSystems 分流注入**（`lib/orch/run.js:2809`）：explore 外部系统按名称分流——基础设施（mongo/redis/kafka/zookeeper/s3/minio 等）→ storage 层圆柱节点；真外部对端（推送网关/第三方 API）→ stadium 外部角色。
2. **trunkStory 注入 plan prompt**（`lib/orch/run.js:2851`）：分离 stadium/cylinder 节点说明，指导边链按真实数据流组织。
3. **INFRA\_RE 扩展**（`lib/orch/run.js:765`）：覆盖 zookeeper/s3/minio。
4. **确定性扫尾 pass**（`lib/orch/run.js:1466-1644`）：

   - 基础设施圆柱归位：被误画为 stadium 的基础设施强制改圆柱；infra 圆柱错层（含飘在 subgraph 外「外部角色区」的）强制移入 storage 子图并修正 class；

   - 部署假边删除：移除外部角色直连进程入口的「部署/启动」边（部署关系应经 ops 节点）。
5. 单测 99/99 通过。

## Phase 2a: 机评（修复后 orch8d 三轮）

| 管线    | 轮次 | 幻觉 | sHigh | sMed | 节点 | 边  | 机评分 | 否决 |
| ----- | -- | -- | ----- | ---- | -- | -- | --- | -- |
| orch4 | r1 | 0  | 0     | 9    | 30 | 34 | 1   | —  |
| orch4 | r2 | 0  | 0     | 0    | 29 | 36 | 10  | —  |
| orch4 | r3 | 0  | 0     | 0    | 30 | 36 | 10  | —  |
| orch8 | r1 | 0  | **0** | 2    | 31 | 32 | 8   | —  |
| orch8 | r2 | 0  | **0** | 5    | 28 | 31 | 5   | —  |
| orch8 | r3 | 0  | **0** | 0    | 31 | 30 | 10  | —  |

- 幻觉路径：两条管线三轮全部为 0。

- orch8 三轮 sHigh=0、零否决；机评均值 **7.67 vs orch4 7.00**。

- 残余 sMed 为边标签风格类中 severity（如边方向措辞），不否决；orch4 r1 同类 sMed 有 9 个。

- 层归属错误：orch8 三轮最终层归属错误均为 0。

## Phase 2b: 盲评（DeepSeek 评委，匿名 A/B 洗牌）

| 轮次 | orch4 deliverable | orch8 deliverable | 胜者    |
| -- | ----------------- | ----------------- | ----- |
| 1  | 7                 | **9**             | orch8 |
| 2  | 7                 | **9**             | orch8 |
| 3  | 7                 | **8**             | orch8 |

**盲评 3:0 全胜。**

盲评 3 轮分项（均值）：

| 维度                   | orch4   | orch8    |
| -------------------- | ------- | -------- |
| path\_truth          | 8.0     | **9.0**  |
| layer\_semantics     | 7.0     | **8.67** |
| edge\_correctness    | 6.0     | **7.67** |
| business\_naming     | 7.67    | **8.0**  |
| density\_readability | 6.67    | **8.0**  |
| spec\_compliance     | 8.67    | **9.0**  |
| **deliverable**      | **7.0** | **8.67** |

orch8 在全部 7 个维度领先，layer\_semantics（+1.67）、path\_truth（+1.0）、edge\_correctness（+1.67）优势最大：api-svc 形态正确禁画 frontend 层，Agent trunkStory 约束使关键链路完整（API→gRPC→msggateway→Kafka→msgtransfer→存储→push→推送通道），基础设施圆柱归位后存储层语义干净。

## Phase 2c: 成本与稳定性

| 维度                   | orch4 (A) | orch8 (U8)               |
| -------------------- | --------- | ------------------------ |
| LLM 调用/轮             | 9-10 次    | 8-10 次                   |
| Token/轮（均值）          | \~104k    | \~102k                   |
| 额外 dsh 调用            | 无         | 1 次（explore.json 生成，可缓存） |
| blind deliverable 均值 | 7.0       | **8.67**                 |
| blind 方差             | 0（7/7/7）  | 0.22（9/9/8）              |
| 机评否决轮次               | 0         | **0**                    |

修复后 orch8 稳定性问题消除：三轮 deliverable 9/9/8，无机评否决，方差降至 0.22。

## 综合判定

| 维度              | 权重   | orch4        | orch8               | 胜者        |
| --------------- | ---- | ------------ | ------------------- | --------- |
| 机评（幻觉/sHigh/否决） | 0.30 | 均值 7.00      | **均值 7.67，零否决**     | **orch8** |
| 盲评 deliverable  | 0.40 | 7.0          | **8.67（3:0 全胜）**    | **orch8** |
| 成本              | 0.15 | \~104k，无 dsh | \~102k + dsh×1（可缓存） | 持平        |
| 稳定性             | 0.15 | σ²=0         | σ²=0.22             | 持平（均稳定）   |

**最终结论（本仓）**：修复后 **orch8 在 openim 上机评与盲评双维度均胜出**，无否决项。Agent 探索提供的形态判断（api-svc 正确推翻 notify-bus）、trunkStory 与 externalSystems 分流 + 确定性扫尾，对本仓成立。

**外推已收回**：跨仓证伪（vaultwarden 盲胜 + zigbee2mqtt 盲负）命中分支 b → orch8 **仅作 shape 低置信降级，不替换双引擎 A**。见 [`SCORE-U8-CROSS-VALIDATION.md`](./SCORE-U8-CROSS-VALIDATION.md)。

## 下一步

1. ~~扩展到 edge 仓证伪~~ → **已完成**，见 `SCORE-U8-CROSS-VALIDATION.md`（分支 b）
2. ~~vw 否决 / bridge 注入 / auto 入口~~ → **已落地**（`chooseOrchEngine` + sweep 0b + explore 跳过默认 ext）。不扩 U8 为默认引擎。
3. 产品面：`--refine` 走 auto，对外仍只说「精修」。L1（edge 7s 12:0）另案，不绑本闭环。

## 产物路径

- orch4：`/tmp/arch-orch/out/orch4-openim-r{1,2,3}/block-diagram.md`

- orch8（修复后）：`/tmp/arch-orch/out/orch8d-openim-r{1,2,3}/block-diagram.md`

- 机评+盲评+汇总：`/tmp/arch-orch/out/blind-a-vs-u8d/{machine-eval,blind-eval,summary}.json`

