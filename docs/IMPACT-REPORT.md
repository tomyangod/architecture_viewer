# 影响面报告（Impact Report）使用文档

> 版本：0.7.0 起支持 · 对应功能：B3 架构变更增量审计 / B4 影响面驱动风险分级 / C4 影响面报告导出

## 1. 它解决什么问题

架构 Diff 回答的是「**这次改了什么**」（哪些文件/类型/函数增删改、依赖边变化），但评审者真正关心的是「**这次改动会波及谁**」：

- 我改了 `util.js`，有多少文件依赖它？哪些是直接依赖、哪些是间接依赖？
- 删除一个类型，会不会打爆下游十几个调用方？
- 多仓工作区里，哪个仓库的变更波及面最大？

影响面报告通过**反向依赖分析**回答这些问题：沿架构边（import / extends / implements 等）反向遍历，找出所有直接或间接依赖「被改实体」的下游节点。

## 2. 核心概念

| 概念 | 含义 |
|------|------|
| **被改实体（seed）** | Diff 中识别出的变更节点：新增 / 删除 / 修改 / 重命名（重命名的 from、to 两侧都算 seed） |
| **wiring 边** | 架构接线关系：`import`、`extends`、`implements`、`field-type`、`method-param`、`method-return`、`component-props`、`uses`、`calls`。归属边（`declared-in` / `defined-in`）**不计入**依赖 |
| **直接下游** | 直接依赖某个被改实体的节点（反向边一跳） |
| **间接下游** | 经由直接下游二跳及以上依赖的节点（BFS 深度上限 6） |
| **变更簇穿透** | 同一批变更的实体互相依赖时（如 A、B 都在本次改动中且 A→B），BFS 会**穿过**被改实体继续向外找，只把簇边界之外的节点算作受影响下游。避免把「同会话一起改的文件」误报为受害者 |
| **base/head 双图并集** | 删除实体在 head 图中已不存在（用 base 图找旧调用方），新增实体在 base 图中不存在（用 head 图找新调用方）。两图反向边取并集，保证删改增场景都不丢下游 |

## 3. 三种使用方式

### 3.1 会话报告（推荐日常使用）

影响面自动内嵌在架构验收门报告中，无需额外命令：

```bash
npm run arch:report
# 等价于：node lib/cli.js session report . --open
```

- **文本报告**：变更摘要后自动追加「影响面」段（无下游被波及时不显示）
- **HTML 报告**：风险 findings 下方有独立的「影响面」卡片（🔗 图标），层级展示每个被改实体的直接/间接下游
- 报告 JSON（`.av/session-report.json`）中含完整 `impact` 字段

文本示例：

```
--- 影响面（反向依赖：谁会被波及） ---
  被改实体 3 个，受影响下游 2 个
  • [修改] impact.js → 直接下游 2: cli.js, workspace.js，间接 1
```

### 3.2 独立 impact 命令（CI / 任意两版对比）

不依赖 session 基线，直接对任意两个目录快照生成影响面报告：

```bash
node lib/cli.js impact <base-dir> <head-dir> [--json]
```

| 参数 | 说明 |
|------|------|
| `<base-dir>` | 变更前的代码目录（基线快照） |
| `<head-dir>` | 变更后的代码目录（当前快照） |
| `--json` | 输出机器可读 JSON（含 diff 摘要 + 完整 impact 数据） |

典型场景：CI 管线中对比 PR 分支与 merge-base：

```bash
git worktree add /tmp/pr-base origin/main
node lib/cli.js impact /tmp/pr-base . --json > impact.json
```

无下游波及时输出：

```
=== 影响面报告 ===
无变更或无下游依赖被波及。
```

### 3.3 多仓工作区聚合报告

管理多个仓库时，逐仓计算影响面并汇总：

```bash
node lib/cli.js workspace add /path/to/repo-a --name 服务A --config .av/workspace.json
node lib/cli.js workspace report --config .av/workspace.json
```

文本输出中：

- 每个有变更的仓库行追加 `影响:被改N 波及M`
- 汇总行显示跨仓总量：`汇总: 3 仓，2 仓有变更，最高风险 HIGH，影响面: 被改 5 波及 8`
- 加 `--json` 时每仓含 `impact: { changedCount, impactedCount, itemCount }` 字段
- 每仓的 HTML 报告（`<repo>/.av/session-report.html`）内含完整影响面卡片

> 注：沙箱环境无法写 `~/.arch-viewer`，用 `--config .av/workspace.json` 指定仓内注册表（已在 `.gitignore` 中忽略）。

## 4. JSON 数据结构

### 4.1 impact 对象

`computeImpact(diff, baseGraph, headGraph)` 返回：

```json
{
  "changedCount": 3,
  "impactedCount": 2,
  "items": [
    {
      "id": "file:lib/impact.js",
      "change": "modified",
      "label": "修改",
      "node": { "id": "file:lib/impact.js", "name": "impact.js", "kind": "file", "path": "lib/impact.js", "layer": "lib" },
      "direct": [
        { "id": "file:lib/cli.js", "name": "cli.js", "kind": "file", "path": "lib/cli.js", "layer": "lib" }
      ],
      "transitive": [
        { "id": "file:bin/arch-viewer", "name": "arch-viewer", "kind": "file", "path": "bin/arch-viewer" }
      ]
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `changedCount` | 被改实体总数（seed 去重后） |
| `impactedCount` | 受影响下游节点总数（直接 + 间接，跨 item 去重） |
| `items[].change` | `added` / `removed` / `modified` / `renamed-from` / `renamed-to` |
| `items[].label` | 中文标签：新增 / 删除 / 修改 / 重命名 |
| `items[].direct[]` | 直接下游节点元数据（id/name/kind/path/layer） |
| `items[].transitive[]` | 间接下游节点元数据 |

> 注意：没有任何下游被波及的被改实体不会出现在 `items` 中（只改了个叶子模块是正常的）。

### 4.2 多仓聚合对象

`aggregateImpact(repoResults)` 返回：

```json
{
  "totalChanged": 5,
  "totalImpacted": 8,
  "repos": [
    {
      "name": "服务A",
      "status": "ok",
      "changedCount": 3,
      "impactedCount": 5,
      "items": [
        {
          "label": "修改",
          "name": "util.js",
          "kind": "file",
          "path": "src/util.js",
          "direct": 2,
          "transitive": 3,
          "directNames": ["core.js", "api.js"]
        }
      ]
    }
  ]
}
```

错误仓 / 无基线仓的 `changedCount` 与 `impactedCount` 为 0，不影响其他仓汇总。

## 5. 与风险分级的联动（B4）

影响面数据直接驱动风险规则（见 `lib/risk-rules.js`）：

| 规则 | 条件 | 严重度 |
|------|------|--------|
| `broad-impact` | 单个被改实体波及 ≥10 个下游 | 🟠 MEDIUM |
| `broad-impact` | 单个被改实体波及 ≥20 个下游 | 🔴 HIGH |
| `removed-type`（升级） | 删除的类型波及 ≥10 个下游 | 🔴 HIGH（默认 MEDIUM） |
| `removed-type`（降级） | 删除的类型下游 <3 个 | 🔵 LOW（默认 MEDIUM） |

finding 中带 `impactDownstream` 字段记录下游数量。这些 finding 出现在文本/HTML 报告的风险段，触发验收门规则：🔴 HIGH 必须逐条说明并等待处置（退出码 1）。

阈值常量集中在 [risk-rules.js](../lib/risk-rules.js) 顶部（`BROAD_IMPACT_THRESHOLD = 10`、`BROAD_IMPACT_HIGH = 20`、`LOW_IMPACT_REMOVED_THRESHOLD = 3`），可按团队规模调整。

## 6. 算法说明

```
输入：diff（增删改/重命名节点）、baseGraph、headGraph

1. 收集 seeds：diff.addedNodes ∪ removedNodes ∪ modifiedNodes ∪ renamedNodes(from/to)
2. 对 base、head 两图分别构建反向索引（仅 wiring 边）：被依赖方 → 依赖方集合
3. 对每个 seed 做 BFS：
   - 第 1 跳命中的非 seed 节点 → direct
   - 第 2~6 跳命中的非 seed 节点 → transitive
   - 命中的 seed 节点继续穿透（变更簇不计数、不截断）
4. 无任何下游的 seed 不产出 item
5. 汇总 changedCount / impactedCount（全局去重）
```

设计要点：

- **双图并集**解决删除（head 里没了）与新增（base 里没有）的下游查找问题
- **簇穿透**解决「一次会话改了一条调用链」时的连锁误报——链上互调的文件不算受害者，链外才是
- BFS 深度上限 6（`MAX_DEPTH`），防止超大依赖图上的路径爆炸；文本报告最多展示 10 个 item（`MAX_DETAIL`），完整数据走 `--json`

## 7. 边界与已知限制

- 影响面基于**静态架构图**（tree-sitter 提取的 import/extends/implements 等），不分析运行时动态调用、反射、依赖注入容器；动态分发场景的实际波及面可能大于报告
- 函数级 `calls` 边目前不是所有语言提取器都产出，文件级 import 边是覆盖最稳定的依赖信号
- 归属边（declared-in / defined-in）刻意排除——「函数属于某文件」不是架构依赖
- 跨仓依赖（一个仓 import 另一个仓）暂不在 `workspace report` 中联通分析，各仓影响面独立计算后汇总
- 提取器自动跳过 `test/`、`eval/`、`examples/`、`docs/`、压缩文件及 `.gitignore` 忽略项，这些目录中的依赖不会出现在影响面中

## 8. API 参考

```js
const { computeImpact, formatImpactText, aggregateImpact } = require('./lib/impact');

// 核心计算
const impact = computeImpact(diff, baseGraph, headGraph);

// 文本格式化（返回空字符串表示无影响）
const text = formatImpactText(impact);

// 多仓聚合
const agg = aggregateImpact(reportResults); // reportResults: workspace.reportRepo() 的返回数组
```

测试覆盖见 `test/impact.test.js`（核心 BFS/簇穿透）、`test/c4-impact-export.test.js`（独立命令数据结构与多仓聚合）。
