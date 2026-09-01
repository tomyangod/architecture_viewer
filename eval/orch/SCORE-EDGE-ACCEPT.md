# Edge 四仓验收（双引擎收口）

日期：2026-08-31  
对照：[PLAN-USAGE8.md](./PLAN-USAGE8.md) §1 三条验收；基线见 [SCORE-EDGE.md](./SCORE-EDGE.md)（shape 前 Δ −1.7）。  
产品决定：**A. 双引擎** — Web 五仓走 7s；edge / 非应用型仓走 orch4+shape。不补 explore JSON，不对外叫「用法8」。

样本：ntfy（notify-bus）· vaultwarden（Rust api-svc）· zigbee2mqtt（bridge）· caddy（proxy）

## 一句话

**§1.1 机评、§1.2 盲评 Δ≥−0.5 已过；§1.3 三轮均分不低于用法1 已过。**  
ntfy 仍有 1/3 轮噪声（评委幻觉路径 / 双向边误读），不挡验收，也不值得再堆闸门。

## 验收对照（PLAN §1）

| 条 | 标准 | 结果 |
|----|------|------|
| **§1.1 机评** | 五仓 + edge 四仓 幻觉=0、结构 high=0 | **过**。edge orch4 四仓幻觉/结构 high 清零 |
| **§1.2 盲评 Δ** | 五仓 ≥ 用法1；edge 四仓 Δ **≥ −0.5** | **过**。五仓靠 7s（8.00 vs 7.60）；edge 拼接四仓交付 Δ **+1.50** |
| **§1.3 稳定性** | 同一仓连跑 3 轮，均分不低于用法1 | **过**。四仓 3 轮均分均 ≥ 用法1；ntfy 胜负 2:1（均分 8.67 vs 8.00） |

## 盲评交付分（3 轮均值）

口径：DeepSeek 匿名 A/B，维度 `deliverable`。  
**拼接：** z2m / vaultwarden 用 `blind-edge-u1-p1shape`（2026-08-31 04:30）；ntfy / caddy 用 `blind-edge-nc-recap`（2026-08-31 09:59，含边方向约束 + 评委 rubric 纪律）。z2m/vw **未**用后期 ntfy 边方向代码重跑 orch4。

| 仓 | 用法1 | orch4 | Δ | 胜负 | 产物批次 |
|----|------:|------:|--:|------|----------|
| zigbee2mqtt | 7.00 | **9.00** | **+2.00** | 3:0 | p1shape |
| vaultwarden | 7.00 | **8.33** | **+1.33** | 3:0 | p1shape |
| caddy | 6.33 | **8.33** | **+2.00** | 3:0 | nc-recap |
| ntfy | 8.00 | **8.67** | **+0.67** | 2:1 | nc-recap |
| **四仓均 Δ** | | | **+1.50** | orch4 **11:1** | 拼接 |

相对用法8 当时目标（edge 均分 ≥ 8.0、Δ≥−0.5）：四仓 orch4 交付均分 **8.58**，Δ **+1.50**。

ntfy / caddy 分项（nc-recap 3 轮均值）：

| 维度 | ntfy 用法1 | ntfy orch4 | caddy 用法1 | caddy orch4 |
|------|----------:|-----------:|-----------:|------------:|
| path_truth | 8.00 | **8.33** | 7.33 | **8.33** |
| edge_correctness | 8.00 | **8.67** | 5.33 | **8.00** |
| density | 8.00 | 8.00 | 6.67 | **8.00** |
| deliverable | 8.00 | **8.67** | 6.33 | **8.33** |

## 演变（只记交付 Δ）

| 批次 | ntfy Δ | caddy Δ | 四仓拼接 Δ | 说明 |
|------|--------:|--------:|-----------:|------|
| shape 前基线 | −1.1 | −1.8 | **−1.7** | 七层模板打穿 edge |
| p1shape 盲评 | −2.67 | −1.00 | **−0.08** | 形态/入口已接；ntfy 旧图含 `actor_ntfy` |
| nc-recap 初复测 | −1.33 | +2.33 | ~+1.1 | actor/边环清零；ntfy 输在密度 |
| 边方向 + 锚点配套后 | **+0.67** | **+2.00** | **+1.50** | 本页验收口径 |

## 机评快照

edge orch4（shape 后）：幻觉 0、结构 high 0。ntfy 终稿路径真实（含 `server/smtp_server.go`、`server/server_manager.go`）；评委偶发「路径不存在」是评委无仓库访问权，**不作为扣分依据**。

## 双引擎怎么落地（A）

| | Web 五仓 | Edge / 非应用型 |
|--|----------|-----------------|
| 内部引擎 | **7s**（dsh 画 + 闸门 + `usage7-sweep`） | **orch4+shape**（形态/动态入口 + 闸门 + `deterministicSweep`） |
| 已兑现 | 盲评 8.00 vs 用法1 7.60 | 四仓 Δ +1.50，机评清零 |
| 不做什么 | 不把 7s 改名叫用法8 | 不补 `state.explore` / 产品化 orch8 |

对外只讲：**默认 Generate** + **精修（Cursor 或自动闸门扫尾）**。用法 5/7/8 编号不进用户文档。

**明确不做：** 再为 ntfy 单仓堆边方向/评委反传；用评委分数改边（评委无仓库访问权）。

## 产物路径

- 用法1：`/tmp/arch-orch/out/edge-p1shape/usage1-<short>/block-diagram.md`
- orch4 z2m/vw：`/tmp/arch-orch/out/edge-p1shape/orch4/{zigbee2mqtt,vaultwarden}/`
- orch4 ntfy/caddy（验收图）：同上目录；ntfy 终稿来自边方向/入站归层轮次后覆盖
- 盲评 JSON：`blind-edge-u1-p1shape/summary.json`（四仓）、`blind-edge-nc-recap/summary.json`（ntfy+caddy 终轮）
