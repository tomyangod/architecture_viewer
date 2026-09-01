# 交付物质量对比报告：用法1 vs「LLM 替代手写」

**评测日期：** 2026-08-29  
**评测仓库：** [changedetection.io](https://github.com/dgtlmoon/changedetection.io)（本机 clone：`/tmp/arch-viewer-labs/changedetection.io`）  
**主对比视图：** `block-diagram.md`（分层观感主视图）  
**用法1执行者：** 本对话 Cursor Agent（**不需要你手动跑 Chat**；我已按 `AGENT.md` 通读源码写盘）

> **安全：你把 DeepSeek Key 发在了对话里。请立刻到 https://platform.deepseek.com 作废并轮换。**  
> 本报告与仓库内文件**未**写入该 Key；评测仅用环境变量一次性调用。

---

## 0. 问题怎么理解

你问的是：若把用法5（手写）交给 LLM，质量能否达到用法1（Cursor Chat + AGENT.md）？

实测拆成两档 LLM：

| 代号 | 含义 | 对应产品路径 |
|------|------|----------------|
| **DS-digest** | 只喂 `scan()` 摘要 JSON | 现有 `lib/llm-generate.js`（用法6） |
| **DS-code** | 喂 README + 约 10 个源文件摘录（更接近 Chat 能读的上下文） | **产品里还没有**；本次加测 |
| **Agent-1** | 本对话按 AGENT 通读后编写 | 用法1 |
| **Rules-2** | 规则 Generate（对照「垃圾基线」） | 用法2 |

真·用法5（人精修）未单独重画；以其为**理论上限**参照（官方 Coffee Shop 手写稿）。

产物目录：`/tmp/arch-compare/`

---

## 1. 结论（先看这个）

1. **现有 DeepSeek 通路（DS-digest）达不到用法1，也替代不了用法5。** 观感接近规则扫描：层残缺、边机械/错误，仍留模板句，`check --filled` 失败。  
2. **给 LLM 真实源码摘录后（DS-code），分层观感可接近用法1（约 7 层、中文、文件名），但仍有多处幻觉路径，未经「草稿确认」不能当交付物。**  
3. **用法1 之所以通常最好，不是因为「模型牌子」，而是：通读代码 + AGENT 约束 + 人确认草稿。** 同一 DeepSeek，上下文不够就崩；上下文够了仍要审。  
4. **因此：LLM 可以「替代手写劳动」，但不能「替代用法1的审阅闭环」。** 质量上限：`手写 ≥ 用法1（Chat审阅）≥ DS-code（需审）≫ DS-digest ≈ 规则扫描`。

---

## 2. 评分表（交付物视角，0–10）

| 维度 | Agent-1（用法1） | DS-code（富上下文） | DS-digest（产品 llm-generate） | Rules-2 |
|------|------------------|---------------------|--------------------------------|---------|
| 层是否齐全（展/API/调度/采集/存/告警/交付） | **9** | 8 | 3 | 3 |
| 节点路径真实性 | **9** | 5（多处幻觉） | 6（少但真） | 6 |
| 边/数据流是否合理 | **9** | 7 | 2 | 2 |
| AGENT 视觉规范（色/双行标签） | **9** | 8 | 5 | 7 |
| 无模板占位 / 可过 filled check | **10** | 4（仍留模板句） | 4 | 8 |
| 可直接交付（不经人工改） | **8** | 3 | 1 | 1 |
| **综合（可交付）** | **≈9** | **≈5.5** | **≈3** | **≈2.5** |

---

## 3. 事实核查摘录

### 3.1 Agent-1（用法1）抽查

抽查节点对应真实路径：`flask_app.py`、`worker.py`、`worker_pool.py`、`queue_handlers.py`、`notification_service.py`、`content_fetchers/playwright.py`、`templates/`、`static/`、`Dockerfile` → **均存在**。

主链路与代码一致：Flask → Recheck/Notification 队列 → worker_pool/worker → content_fetchers → store/diff → NotificationService / Apprise。

### 3.2 DS-digest（`llm-generate.js`）问题

- 只有 API / Worker /（文档或 Ops），**缺前端、存储、监控告警**（而这正是该产品架构的核心）。  
- 出现明显反直觉边：如 `worker_pool → flask_app`。  
- C4 Container 写 **SQLite**；实际持久化是 **`store/` 文件型 datastore（JSON/orjson）+ volume**，属臆造。  
- 标题出现 `method6-full-repo` 一类复制仓名。  
- 末尾仍保留 `*模板文件 · 请替换...*` → protocol **6 个 filled 错误**。

### 3.3 DS-code（富上下文）问题（观感好、可信度不够）

存在/可定位的幻觉或不准确节点：

| 图中写法 | 核查 |
|----------|------|
| `changedetectionio/ticker.py` | **不存在** |
| `changedetectionio/socketio` | **不存在**；实时在 `realtime/socket_server.py` |
| `notification.py` | **不存在**；应为 `notification_service.py` / `notification/` |
| `processors/ai/` | **不存在**（有 `processors/text_json_diff` 等） |
| `datastore/` + SQLite 圆柱 | **误导**；实现是 `store/` 文件 datastore |

视觉上已「像用法1」，但**不经草稿确认就会把错架构交付出去**——这正是用法1里「先看草稿再写盘」的价值。

---

## 4. 对你两个问题的直接回答

### Q1：手写交给 LLM，能否达到用法1？

| 条件 | 能否达到用法1 |
|------|----------------|
| 只用现在的 `lib/llm-generate.js`（扫描摘要） | **不能** |
| LLM + 大量源码上下文 + **人工草稿确认**（≈ Chat 流程） | **可以接近**用法1 |
| LLM 全自动、零审阅 | **不能稳定达到**；本次 DS-code 已证明幻觉率不可接受 |
| 相对真·手写精品（Coffee Shop / 你的附件） | LLM 可替代「初稿劳动力」，**终稿仍常需人改 10–30%** |

### Q2：用法1 要你来做还是我来做？

**我可以做（本次已做）。**  
在本对话里通读仓库 + 按 AGENT 写 md，就是用法1的 Agent 侧。你若要在自己的 Cursor Chat 复现，只需 `@AGENT.md` 发提示词；评测本身不依赖你再跑一遍。

---

## 5. 产物路径（便于你肉眼打开对比）

```text
/tmp/arch-compare/
  method1-cursor-agent/block-diagram.md     ← 用法1
  method6-deepseek/block-diagram.md         ← DS-digest（--only）
  method6-deepseek-full/*.md                ← DS-digest 六视图
  method6-deepseek-enriched/block-diagram.md← DS-code 富上下文
  method2-rules/block-diagram.md            ← 规则基线
```

预览示例：

```bash
# 用法1
cp /tmp/arch-compare/method1-cursor-agent/block-diagram.md \
  /tmp/arch-viewer-labs/changedetection.io/architecture_viewer/
cd /tmp/arch-viewer-labs/changedetection.io/architecture_viewer
python3 -m http.server 8091
# http://127.0.0.1:8091/architecture_visualized.html?tab=block
```

---

## 6. 对产品叙事的建议（基于本次实测）

1. **不要把「DeepSeek / Generate」宣传成与用法1同级的出图方式。**  
2. 若要 LLM 对标用法1：必须 **扩上下文（读关键源文件）+ 强制人审草稿 + 去掉模板尾句 + 路径存在性校验**。  
3. 用法5 的「质量上限」仍在；LLM 是压缩人时，不是取消验收。

---

## 7. 一句话

**用法1 我已代跑；现有 DeepSeek 用法达不到它；「LLM 替代手写」只有在「像 Chat 一样给代码 + 像用法1一样审草稿」时才能接近——否则观感能骗过眼睛，架构事实经不起核对。请先轮换 API Key。**
