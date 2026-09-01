# 用法1 vs 用法5 vs 用法7 · 五仓综合评分

样本：changedetection.io / listmonk / uptime-kuma / memos / umami\
日期：2026-08-30（u7s 终评 2026-08-31）\
用法7 执行：`dsh --profile headless`（`@deepseek-ai/dsh@0.1.1-rc.2`）+ `DEEPSEEK_API_KEY`，cwd=各仓，只覆写 `architecture_viewer/block-diagram.md`

> **安全：** 评测用的 API Key 曾出现在对话中，请到 <https://platform.deepseek.com> **立即轮换**。本文件未写入任何密钥。

***

## 综合结论（交付分 · 主结论）

| 口径               | 用法1 Cursor Agent+AGENT | 用法5 orch3 LLM 引擎 | 用法7 dsh 裸 Agent | **用法7s dsh+闸门+扫尾**        |
| ---------------- | ---------------------- | ---------------- | --------------- | ------------------------- |
| **交付均分**         | **8.9**（历史完整基线）        | **8.1**          | ≈7.0            | **8.0**（绝对盲评）             |
| 相对用法1            | —                      | −0.8             | ≈−1.9           | **−0.3 \~ −0.9（噪声带内，追平）** |
| 幻觉路径（真问题）        | 全 0                    | 全 0              | 部分仓有            | **全 0**                   |
| 结构闸门 high/medium | 有边方向瑕疵                 | 全 0              | 多               | **全 0**                   |
| 确定性闸门            | 人工审阅                   | 有（orch 流水线）      | 无               | **路径打回 + 确定性扫尾**          |
| 观感（分层/中文/双块）     | 强                      | 强                | 强（常有子图2）        | **强（五仓双块齐全）**             |

```
手写精品 ≥ 用法1（≈8.9）≈ 用法7s（8.0，盲评噪声带内追平）≥ 用法5 orch3（≈8.1）≫ 用法7 裸 Agent（≈7.0）≫ digest / 规则扫描
```

**追平判定（2026-08-31 终评）：** 用法7s（dsh 起草 → 路径硬闸门打回 → 确定性扫尾）五仓机检**全绿**（幻觉 0 / 结构 high\&medium 0 / 幽灵节点 0 / 双块齐全 / 块1 节点 15–22），绝对打分盲评交付均分 **8.0**；与完整用法1 历史基线（8.3–8.9）差距 0.3–0.9，在评委 ±1.0 噪声带内 → **「LLM/Agent 生成路径交付物追平用法1」目标达成**。详见文末 [用法7s 终评](#用法7s-终评2026-08-31dsh--路径闸门--确定性扫尾)。

**更新历程：**

1. 裸 dsh ≈ 7.0（无闸门，umami 等有幻觉路径）；
2. 加路径硬闸门 + 打回（`usage7-gated.js`）→ **8.3**，幻觉归零；
3. 再加确定性扫尾（`usage7-sweep.js`）→ **8.0 绝对盲评 + 机检全绿**，密度/环/反向边/圆柱/actor 等机械问题清零。

***

## 逐仓交付分

| 仓库                 |     用法1 |     用法5 |  **用法7** |  U7 相对 U1 |
| ------------------ | ------: | ------: | -------: | --------: |
| changedetection.io |     9.2 |     8.9 |  **7.2** |      −2.0 |
| listmonk           |     8.8 |     8.2 |  **7.5** |      −1.3 |
| uptime-kuma        |     8.7 |     8.0 |  **8.0** |      −0.7 |
| memos              |     8.9 |     7.8 |  **7.5** |      −1.4 |
| umami              |     8.8 |     7.6 |  **5.0** |      −3.8 |
| **均分**             | **8.9** | **8.1** | **≈7.0** | **≈−1.9** |

用法1 / 用法5 交付分沿用 [SCORE-U1-vs-U5.md](./SCORE-U1-vs-U5.md)。\
用法7 交付分：同一权重（事实 25% · 主链路 25% · 分层语义 20% · 视觉 15% · 覆盖 15%），结合机评幻觉 + 人工抽看主链路后估分（**非**第二轮盲评 LLM 评委；若要严格盲评可再跑 `blind-u1-u5.js` 三方版）。

***

## 机评分（事实底线 · 不作唯一交付标准）

`node eval/orch/score-multi.js`（幻觉/层闸门/覆盖/样式启发式）：

| 仓库                 |     用法1 |      用法5 |     用法7 | U7 幻觉数 |
| ------------------ | ------: | -------: | ------: | -----: |
| changedetection.io |     8.8 |      8.4 |     4.4 |      3 |
| listmonk           |     7.4 |     10.0 |     6.8 |      1 |
| uptime-kuma        |     7.8 |     10.0 |   3.6\* |      1 |
| memos              |    10.0 |     10.0 |     7.4 |      0 |
| umami              |     9.4 |      8.9 |     1.8 |      4 |
| **均分**             | **8.7** | **9.5†** | **4.8** |      — |

\* uptime-kuma 用法7 **观感很好**，机评被 `layerGate` 关键词误伤（如把 `src/router.js` 判到 api、把 `monitor.js` 从 worker 判到 monitor）→ 机评分低估。\
† 用法5 机评易被 orch 闸门刷高，[SCORE-U1-vs-U5](./SCORE-U1-vs-U5.md) 已说明：只作事实底线。

### 用法7 真实幻觉摘录（路径不存在）

| 仓               | 问题                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------- |
| changedetection | `requests/playwright/puppeteer`、`text_json_diff/restock_diff`、`github/workflows`（把技术名/目录习惯写成路径） |
| listmonk        | `knadh/smtppool`（像依赖名，不是仓内路径）                                                                   |
| uptime-kuma     | `SQLite/MySQL/PG`（技术串被当成路径；其余节点大多真实）                                                            |
| memos           | 无硬幻觉                                                                                            |
| umami           | `public/script.js`、`public/recorder.js`、错误的 workflow 路径等                                        |

***

## 方法对照

| <br /> | 用法1                           | 用法5（orch3）         | 用法7（dsh）                 |
| ------ | ----------------------------- | ------------------ | ------------------------ |
| 宿主     | Cursor Agent / 本对话 Agent      | `eval/orch/run.js` | `dsh --profile headless` |
| 模型     | Cursor 背后模型                   | DeepSeek API       | DeepSeek API             |
| 读仓     | Agent 工具读文件                   | 全树+摘录+闸门           | Agent 工具读文件              |
| 写什么    | 按 AGENT 六视图/本测为 block         | 编排只出 block         | 本测只出 block               |
| 路径闸门   | 人审                            | **确定性 gate**       | 无（除非你再接 orch/check）      |
| 要 Key  | Cursor 额度                     | DeepSeek Key       | DeepSeek Key             |
| 产物     | `/tmp/arch-orch/out/usage1-*` | `orch3-*`          | `usage7-*`               |

***

## 产品含义

1. **用法7 成立**：harness 能替代「用法1 的 Agent 宿主」，不是新 Viewer。
2. **质量上**：裸 dsh ≈「用法1 去掉严格人审 + 去掉 orch 闸门」→ 观感够用，**事实稳定性不如用法5 引擎，也不如用法1**。
3. **若要把用法7 拉到用法5 附近**：生成后强制 `check --drift` + 路径存在性脚本（或让 dsh 调用本仓库 `lib/cli.js` / orch gate），不要只信 Agent 终稿。
4. **对外叙事建议**：

   * 主路径仍是扩展 Generate + Preview

   * Agent 精修：**Cursor（用法1）或 dsh（用法7）二选一**

   * 「接近用法1 的自动引擎」继续指 **orch3/用法5**，不要把裸 harness 宣传成同级

***

## 复现用法7（单仓）

```bash
export DEEPSEEK_API_KEY='sk-...'   # 勿提交仓库
cd /tmp/arch-orch/repos/listmonk
node /path/to/architecture_viewer/lib/cli.js init .
npx --yes @deepseek-ai/dsh@0.1.1-rc.2 --profile headless "$(cat /tmp/arch-orch/usage7-prompt.txt)"
# 预览
cd architecture_viewer && python3 -m http.server 8083
```

若本机 `npm config get before` 被设成过去日期，会导致 `npx` `ETARGET`；可 `npm config delete before`，或改用已缓存的：

`~/.npm/_npx/*/node_modules/.bin/dsh`

***

## 用法7s 终评（2026-08-31）：dsh + 路径闸门 + 确定性扫尾

**流水线**（产物 `/tmp/arch-orch/out/usage7s-<仓>/`）：

```
dsh headless 起草（read/bash/write 自由探索，按 AGENT.md）
  → 路径硬闸门：lintBlockDiagram 查 <small> 路径，不在文件树就打回重写（最多 2 轮）   [usage7-gated.js]
  → 确定性扫尾：圆柱纠正 / 密度剪枝 / 环与反向边 / ops 虚线 / actor 注入 /
              孤立节点 / 重复边 / realtime 路径内容核验改指 / 块2 前端资产归色        [usage7-sweep.js]
```

### 1. 机检（事实底线 · 五仓全绿）

| 仓               | mermaid 块 | 块1/块2 节点 |  幻觉路径 | 结构 high/med | 视觉 high |  幽灵节点 |
| --------------- | :-------: | :------: | :---: | :---------: | :-----: | :---: |
| changedetection |     2     |  19 / 9  | **0** |  **0 / 0**  |  **0**  | **0** |
| listmonk        |     2     |  22 / 12 | **0** |  **0 / 0**  |  **0**  | **0** |
| uptime-kuma     |     2     |  18 / 7  | **0** |  **0 / 0**  |  **0**  | **0** |
| memos           |     2     |  21 / 12 | **0** |  **0 / 0**  |  **0**  | **0** |
| umami           |     2     |  15 / 7  | **0** |  **0 / 0**  |  **0**  | **0** |

对照：完整用法1 changedetection 为 24+8 节点——u7s 密度同档且更精瘦。密度闸门阈值（块1 ≤28、块2 ≤16）五仓均达标。

### 2. 盲评（交付分）

**(a) 绝对打分盲评**（10 份产物匿名、单图独立评分，去 A/B 相对锚定；`blind-abs-u7s.js`）：

| 仓               |  u7s 交付分 | 同场 usage1 存档 |
| --------------- | :------: | :----------: |
| changedetection |     8    |       8      |
| listmonk        |     8    |       8      |
| uptime-kuma     |     8    |       8      |
| memos           |     8    |       7      |
| umami           |     8    |       7      |
| **均分**          | **8.00** |   **7.60**   |

评委一致评语：u7s「分层清晰、主链路完整、路径真实、小修即可交付」；残留瑕疵均为小修级（如 listmonk 块2 缺存储→发信管道连线、umami api\_collect→redis 边语义可议）。

**(b) 3 轮 A/B 配对盲评**（`blind-u1-u7s.js --round 1..3`，15/15 仓次）：u7s 全胜，纸面 Δ 2.2–2.6。**但此结果必须打折**：

* 存档的 4/5 仓 usage1 产物是**截断版**（只有子图1、末尾残留「*模板文件 · 请替换…*」行，memos 仅 91 行）；仅 changedetection 为完整双块版。

* **同一批截断文件**在 orch4 时代 6 轮 A/B（对手是更弱的 orch4）中交付分均值 **8.3**（cd 9.0 / listmonk 8.8 / memos 8.2 / kuma 8.0 / umami 7.7），在 u7s 时代 A/B 中仅 6.6——**同一份图分差 1.7 分，证明是评委相对锚定噪声（±1.5），不是图变了**。

* 因此「u7s 反超用法1 2.5 分」**不成立**；可采信的是：u7s 稳定优于截断基线，且绝对质量 8.0。

### 3. 追平判定

| 比较口径                 | 差距                                                       | 判定                                |
| -------------------- | -------------------------------------------------------- | --------------------------------- |
| 事实正确性（幻觉/结构/幽灵/密度）   | u7s 全绿；用法1 历史上有边方向瑕疵（mig→dbdriver、compose→image 等评委多次指出） | **追平并反超**                         |
| 交付观感（绝对盲评）           | u7s 8.0 vs 完整用法1 历史 8.3–8.9                              | **差距 0.3–0.9，在评委 ±1.0 噪声带内 → 追平** |
| A/B 纸面 15/15 胜、Δ 2.5 | 对手为截断存档                                                  | **不采信为反超证据**                      |

**结论：** 「让 LLM/Agent 生成路径交付物追平用法1」的目标**达成**——但不是靠更强模型或更多轮 LLM 批判，而是靠分工：**Agent 负责探索与叙事（它比规则扫描更懂业务），确定性闸门负责对错（路径必须在文件树里），确定性扫尾负责品相（圆柱/密度/环/反向边/actor 等机械问题不让 LLM 反复改）**。LLM 批判节点接地化 + 状态不回退，是此前 orch 轮次的核心教训；本轮证明最后一公里必须由代码扫尾闭环。

### 4. 同期修复的扫尾引擎 bug（run.js deterministicSweep，产品化 llm-generate 路径）

* **幽灵节点根因确认已修复**：前缀归位时目标层缺失会「先删后插」吞掉节点声明（umami worker\_tracker/worker\_recorder 教训）。现行代码对目标层缺失的节点**原地改名保留声明**（run.js 0.6 节，`toRename` 分支），圆柱归位在存储层缺失时**自动新建子图**（0 节）；最小回归用例验证：声明 100% 存活、0 幽灵节点。

* **新修误触发**：规则 B 的前端资产正则把 Next.js 服务端路由 `src/pages/api/` 误判为浏览器资产（`pages` 关键词），导致 `api_server` 被错移到前端层并连锁触发空层删除/改名。已加 `(pages|app)/api/` 例外（run.js 规则 B），回归用例验证 api 节点留在 API 层、tracker/recorder 正确改名留前端层。`npm test` 19/19 通过。

### 5. 复现

```bash
# 1) dsh 起草 + 路径闸门打回（需 DEEPSEEK_API_KEY 环境变量；产物 usage7g-*）
node eval/orch/usage7-gated.js
# 2) 确定性扫尾（产物 usage7s-*）
node eval/orch/usage7-sweep.js
# 3) 绝对打分盲评
node eval/orch/blind-abs-u7s.js
# A/B 盲评（注意：usage1 存档为截断版，结论需按上文打折）
node eval/orch/blind-u1-u7s.js --round 3
```

