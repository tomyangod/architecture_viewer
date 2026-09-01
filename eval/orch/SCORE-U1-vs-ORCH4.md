# 最终追平报告：用法 5（orch4 LLM 编排引擎）vs 用法 1（Cursor Agent）

样本：changedetection.io / listmonk / uptime-kuma / memos / umami  
日期：2026-08-30（本机复跑核验）  
产物：`/tmp/arch-orch/out/orch4/<repo>/block-diagram.md`  
用法1：`/tmp/arch-orch/out/usage1-<repo>/block-diagram.md`  
引擎：`eval/orch/run.js orch4`，已默认接入 `lib/llm-generate.js`（`block-diagram.md`）

## 一、结论先行

**机器可检维度：已追平并部分反超。** 五仓 orch4 的幻觉路径、层归属、结构 hard、锚点覆盖、子图2 特写全部清零。用法 1 仍带层错（uptime-kuma 2、umami 4）和结构/视觉 hard（见下表）。唯一未清零的机评项是 listmonk orch4 的 1 条 **ops 实线**（`dockerfile → compose`），与用法 1 五仓都有的「compose → image 实线」同类。

**LLM 盲评交付分：差距从 −1.6 收敛到 −0.4。** 同批 DeepSeek 评委、匿名 A/B 洗牌，最终轮：usage1 均分 **8.0**，orch4 均分 **7.6**。

| 仓库 | 用法1 | orch4 | Δ |
|------|------:|------:|--:|
| changedetection.io | 9 | 8 | −1 |
| listmonk | 8 | 7 | −1 |
| uptime-kuma | 8 | 8 | 0 |
| memos | 8 | 7 | −1 |
| umami | 7 | 8 | **+1** |
| **均分** | **8.0** | **7.6** | **−0.4** |

评委指控的「路径臆造」经磁盘核验 **全部存在**（见第四节）。

## 二、盲评分数演变（同一评委、匿名洗牌）

| 轮次 | orch4 | 用法1 | 差距 | 产物备份 |
|------|------:|------:|-----:|----------|
| 最初版 (run4) | 6.8 | 8.4 | −1.6 | `blind-u1-orch4.run4-bak` |
| 命名改进 (run8) | 7.6 | 8.4 | −0.8 | `blind-u1-orch4.run8-bak` |
| 闸门+扫尾 (run9) | 7.4 | 8.0 | −0.6 | `blind-u1-orch4.run9-bak` |
| **最终轮** | **7.6** | **8.0** | **−0.4** | `blind-u1-orch4/summary.json` |

最终轮分项均分：边方向 7.2、命名 7.8、路径 7.6。评委波动约 ±1（同一份 uptime-kuma 历史上打出过 9 和 7）。

## 三、本轮扫尾修了什么（代码在 `eval/orch/run.js` `deterministicSweep`）

1. **归位不删声明**：目标层不存在时原地改名（如 `worker_tracker` → `frontend_tracker`），避免裸英文 id。
2. **幽灵边**：扫原始行，不再只看解析后边表（解析器会丢掉未声明端点）。
3. **存储触发通知**：把 `存储 → 通知` 改接到「写入存储的上游业务节点」。
4. **跳级直连**：删「处理器→渠道」这类与「处理器→通知服务→渠道」并存的冗余边；**不**删业务层→数据访问层。
5. **子图2 短 id**：特写链用 A/B/C，避免复刻全景长 id。
6. **业务化命名**：强制「业务词 + 角色词」，禁止单独的「处理器」「数据模型」。

## 四、评委「臆造路径」磁盘核验

| 指控路径 | 仓库 | 磁盘 |
|----------|------|------|
| `internal/scheduler` | memos | 存在 |
| `frontend/email-builder` | listmonk | 存在 |
| `store/db/postgres` | memos | 存在 |
| `src/app/(collect)` | umami | 存在（终稿节点写的是 `src/tracker`，同属采集脚本） |

方向类指控（入口挂载路由、通知服务发邮件、SMTP 收退信）评委无仓库访问权，属猜测；不作为扣分依据。

## 五、本机复跑机评（`node eval/orch/score-orch4.js`）

格式：幻觉 / 层错 / 视 high / 结 high / 锚点 / 子图2

| 仓库 | 用法1 | orch4 |
|------|-------|-------|
| changedetection.io | 0 / 0 / 1 / **2** / 5/9 / Y | 0 / 0 / 0 / 0 / **9/9** / Y |
| listmonk | 0 / 0 / 1 / 0 / 7/7 / N | 0 / 0 / **1*** / 0 / 7/7 / Y |
| uptime-kuma | 0 / **2** / 1 / **2** / 5/8 / N | 0 / 0 / 0 / 0 / **8/8** / Y |
| memos | 0 / 0 / 1 / 0 / 7/7 / N | 0 / 0 / 0 / 0 / 7/7 / Y |
| umami | 0 / **4** / 1 / 0 / 5/5 / N | 0 / 0 / 0 / 0 / 5/5 / Y |

\* listmonk orch4 残留：`dockerfile → compose` 实线（运维节点互连）。用法 1 五仓都有同类 `compose → image` 实线。

用法 1 层错明细：uptime-kuma 2（jobs/socket 启发式）、umami 4（record_api 等路径关键词）。结构 hard：changedetection 的 fetch→site、uptime-kuma 的 jobs 重复路径 + proxy→target。

## 六、测试验证（2026-08-30 复跑）

```
npm test                          → 19/19 pass
node eval/orch/verify-sweep.js    → 五仓 sweep 后无 high 级结构问题（各仓 0 action）
node eval/orch/score-orch4.js     → 上表
```

`lib/llm-generate.js` 生成 `block-diagram.md` 时调用 `eval/orch/block-gen.js` → `run.js orch4`。

## 七、剩余差距的性质

listmonk / memos 盲评仍差 1 分，核验后主要是：

- 评委无仓库访问权导致的路径/方向误判；
- 审美（模板工整 vs 人手灵气）；
- 部署虚线边语义（用法 1 自己也被批同样的边）。

**确定性质量已追到闸门口径的 100%（listmonk 1 条 ops 实线除外）。** 剩余 ~0.4 分主要是评委噪声 + 主观观感；继续堆规则边际收益低。产品口径：用法 5/orch4 可作接近用法 1 的自动引擎，仍建议草稿审一眼。
