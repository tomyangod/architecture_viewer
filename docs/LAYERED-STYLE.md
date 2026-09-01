# 分层架构通解

目标：任意仓库 `generate` 都能产出附件那种「彩色分层 + 图标 + 中文名/文件名」的 block 图，而不是只改某个示例项目。

## 三条通路（同一套视觉规范）

| 通路 | 何时用 | 要不要 API Key |
|------|--------|----------------|
| **规则生成** `arch-viewer generate` | 默认；扫描目录/compose/入口 → 自动归层 | **不需要** |
| **Cursor + AGENT.md** | 人工审阅、补业务语义 | Cursor 额度即可 |
| **DeepSeek LLM** `lib/llm-generate.js` | 大仓、要对齐用法1 的分层交付质量 | 需要 `DEEPSEEK_API_KEY`；**block-diagram.md 走 orch4 编排**（重要性取证+结构/视觉闸门+确定性扫尾） |

视觉规范写在 `AGENT.md`（block-diagram 一节）；实现写在 `lib/layers.js`。

## 语义层（空层不画）

`frontend` → `api` → `schedule` → `worker` → `storage` → `monitor` → `ops`

扫描时按目录名/服务名/文件名正则归层；只有有节点的层会出现在图上。

## 可选覆盖（通解扩展点）

仓库根放 `architecture.layers.json`（见 `templates/architecture.layers.example.json`）：

- `order` / `titles`：层顺序与中文层名  
- `nodes`：强制节点（id / layer / title / sub）  
- `aliases`：把已扫描节点改层  
- `edges`：自定义箭头（不写则层间自动连）

## 命令

```bash
# 任意仓库 → 六视图（分层图走通解模板）
node lib/cli.js generate /path/to/repo

# 只要更好的中文业务分层图（推荐；block 图使用 orch3 编排引擎）
export DEEPSEEK_API_KEY=sk-...
node lib/llm-generate.js /path/to/repo --only block-diagram.md

# 编排实验对照（可选）
# node eval/orch/run.js /path/to/repo orch3 /tmp/orch3-out
```

## 边界

Mermaid 排版不如 Visio 自由拖拽，但彩色分层 + 双行标签是可规模化的「一眼分层」方案。像素级复刻手绘不是默认路径。
