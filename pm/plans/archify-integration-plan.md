# Archify 集成实施方案

> 日期：2026-09-04（当日晚已落地 Phase 1 + 渲染器开关，基线已刷）
> 状态：Phase 1/2 核心完成；vendor 入库与发 0.12.0 待提交
> 进度快照：`pm/reports/STATUS-2026-09-04.md`
> 前置：`pm/reports/ARCHIFY-COMPARISON-2026-09-04.md`（若有）
> Archify 版本：`archify-main/archify` → **2.17.0-dev.1**（本地参考副本）

## 一、目标

把 Archify 作为**渲染层**接入，Architecture Viewer 专注代码分析与风险判定；同时把我们的分析能力包装成 Archify 生态的「代码事实数据源」。

```
源码 ──► extract-graph ──► diff-graph / risk-rules / impact   ← 壁垒（保留）
                              │
                              ▼
                      lib/export-archify.js（新增 IR 适配器）
                              │  稀疏视图 + 合法 id + 分层 grid
                    ┌─────────┴──────────┐
                    ▼                    ▼
          Archify CLI（vendored）   IR JSON（给 Chat 里的 archify skill）
          validate / render / compare
                    │
                    ▼
          精美交互 HTML（Before / Delta / After）
```

## 二、精读结论（Skill / CLI / Delta / 本仓图谱）

### 2.1 Skill 接入方式

- 分发：`npx skills add tt-a1i/archify`（GitHub Skill 包），**不上 npm**（`package.json` `"private": true`）。
- Agent 契约（`SKILL.md`）：选 type → 读 schema + 一例 → **先写 candidate JSON** → `validate --quality showcase|standard --json` → `deliver` 出 HTML → 可选 `visual-check`。
- 我们不扮演「写图的 Agent」；我们扮演 **从源码产出 candidate IR 的前置**，再调同一套 CLI。

### 2.2 CLI 入口（对本方案有用的命令）

| 命令 | 用途 |
|---|---|
| `validate architecture <json> --quality standard --json` | 校验；非零 = 不可交付 |
| `render architecture <json> <out.html> --quality standard` | 单快照 HTML |
| `compare architecture <base.json> <head.json> <out.html> --json` | Before/Delta/After + receipt |
| `deliver` / `preview` / `doctor` | Phase 2+ 可选；日常以 validate/render/compare 为主 |

调用方式：我们是 CJS，Archify 是 ESM — **只走子进程** `node path/to/bin/archify.mjs …`，不 `import`。

### 2.3 Delta 数据格式（`delta/architecture-delta.mjs`）

- 输入：两份 **architecture** IR（`schema_version: 1`），不是我们的 `session-report.json`。
- **稳定身份**：
  - components：`components[].id`（必填、唯一）
  - connections：`connections[].id`（**compare 要求必填**）
  - boundaries：派生键 `kind + "\u001f" + label`（同 kind+label 不可重复）
- 状态机（与我们 diff 用语接近，但语义绑定 IR 字段）：

| status | 含义（Archify） |
|---|---|
| `added` / `removed` | 仅一侧存在 |
| `changed` | 语义/拓扑字段变了（type/label/tag/from/to/variant/wraps…） |
| `moved` | 组件仅 geometry 变（row/col/pos/size） |
| `rerouted` | 边仅 geometry 变（via/sides/route…） |
| `evidence-changed` | 仅 `sources` 变 |

- receipt 明确写着：*Authored Architecture IR only; no runtime impact, causality, risk…* — **风险/影响面仍由我们算**，只把违规边画成红色。

### 2.4 本仓图谱结构（`lib/extract-graph.js` / `diff-graph.js`）

```
graph = {
  version, root, fingerprint, languages, stats,
  nodes: [{ id, kind, name, path, layer, lang, ... }],  // kind: file|class|function|component|external|…
  edges: [{ from, to, type, file, line }],             // type: import|extends|implements|declared-in|…
  layerSignals
}
diff = {
  addedNodes, removedNodes, modifiedNodes, renamedNodes,
  addedEdges, removedEdges, …  // 边对象扁平，含 from/to/type
}
```

文件节点 id 形如 `file:lib/cli.js`；实体 id 语言相关。这些 **不能原样写入 Archify**（见下节）。

### 2.5 Spike 实测（2026-09-04，本机 `archify-main`）

| 尝试 | 结果 | 含义 |
|---|---|---|
| 9 文件全量 import 边 + `f:lib/cli.js` 风格 id | validate 失败 | id 模式 / 布局双重不过 |
| 同上，id 清洗后仍全量边 | `clean-flow/edge-through-node` × N + `layout/constraint` | **standard 也 fail-closed 穿线检测** |
| **稀疏 7 节点 + 层间边 + 显式 fromSide/toSide** | validate / render / compare **全部 exit 0** | 产物：`sparse-head.html` ~707KB，`sparse-delta.html` ~2MB；receipt 正确检出 +1 component / +1 security 边 / boundary wraps 变化 |

结论：**方案可落地，但默认必须导出「稀疏、已排版」的 IR，不能把全仓 import 图原样塞进 Archify。**

## 三、硬约束（方案必须遵守，纠正初稿错误）

1. **id 字符集**：`^[a-zA-Z][a-zA-Z0-9_-]*$`（`common.schema.json`）。禁止 `:` `/` `.` `#`。  
   编码约定：`f_` + path 中非字母数字改 `_`（例：`lib/cli.js` → `f_lib_cli_js`）；实体：`e_` + path + `_` + name 清洗。维护 **双向映射表**（archifyId ↔ 我们的 node.id / path）写在导出 sidecar 或 IR 的 `sublabel`/`tag` 里。
2. **grid ≠ 自动布局**。`grid.mjs` 注释原文：*Not auto-layout — fixed cell math only*。每个 component 必须有 `pos` **或** `(row, col)`；`col < layout.cols`。适配器要自己算行列。
3. **`sources` 与 `meta.repository` 绑定**。带了 `component.sources` 就必须有 `meta.repository`，否则 `repository-evidence/repository-required`。本地会话默认 **不写 sources**；有公开 git remote 时再写。
4. **clean-flow 在 standard 下也是错误级**。边穿过无关节点 → validate/render/compare 全失败。对策不是「关掉校验」，而是：
   - 默认 `--scope changed|violations`（节点 ≤ ~12，边 ≤ ~20）
   - **按 layer 分行**：上层 row 小，下层 row 大；跨层边强制 `fromSide: "bottom"`, `toSide: "top"`
   - 同层边尽量相邻 col，或省略同层边（只保留跨层 / 违规）
   - 超限时降级为 **layer-summary**（一层一个节点，边=跨层依赖聚合）
5. **connection.id 对 compare 必填**（receipt `identity.connections`）。适配器永远生成稳定边 id，例如 `c_<from>__<to>__<type>`（已清洗）。
6. **boundary 身份是 kind+label**。层名不要随会话改文案，否则 delta 会报成删+增两个 boundary。

## 四、数据模型映射（修订版）

### 4.1 导出模式（默认稀疏）

| `--scope` | 行为 |
|---|---|
| `changed`（**默认**） | 仅 baseline↔head 的 added/removed/modified/renamed 文件（及一跳邻居可选） |
| `violations` | 仅跨层违规边的端点 + 违规边（`variant: security`） |
| `layers` | 每 layer 一个 component，边=层间依赖计数 |
| `all` | 仅小仓或显式要求；超过阈值自动降到 `layers` 并在 CLI 打印提示 |

`--granularity file|entity`：在 changed/violations 下可选；默认 `file`。

### 4.2 节点 / 层 / 类型

| 我们 | Archify |
|---|---|
| file / entity | `components[]`（id 清洗后） |
| layer | `boundaries[]` `kind: "region"`，label 固定为 `"<layer> layer"` |
| layer 名 | `tag` + `sublabel`（可读路径） |
| component → `frontend`；controller/service/domain/dto/config/util → `backend`；storage → `database`；external → `external` | |

### 4.3 边

| 我们 | Archify |
|---|---|
| import（跨层 / 变更相关） | connection，可无 label |
| extends / implements | `variant: "dashed"` + label |
| 违规 | **`variant: "security"`** + 规则名 label |
| field-type / method-* / declared-in | 默认不导出 |

### 4.4 布局算法（适配器内实现）

1. 按 layer 固定 row（例：controller=0 … storage=3）。
2. 同层按 path 字典序填 col，`cols = max(同层数, 4)` 且 ≤ 12。
3. 跨层边：`fromSide: bottom`, `toSide: top`。
4. 同层边：仅当 `|col差| ≤ 1` 时保留，否则丢弃或并入 layer-summary。
5. 导出后立刻子进程 `validate --quality standard`；失败则自动再试 `layers` 模式，仍失败则 **只落盘 IR + 诊断 JSON**，报告流程回退 builtin 渲染。

### 4.5 Delta

- baseline graph → `*.base.architecture.json`
- head graph → `*.head.architecture.json`
- 同一套 id 清洗与 layout 种子（**base/head 共用同一套 row/col 分配规则**，仅节点集合不同），这样 Archify 的 `moved` 才有意义；新增节点插在层末尾 col。

## 五、三种集成模式

| 模式 | 内容 | 工时 | 决策 |
|---|---|---|---|
| A. IR 导出 | `lib/export-archify.js` + CLI + MCP；可选调本地 `archify-main` 做 validate | 2–3 天 | **Phase 1** |
| B. Vendor 渲染 | `vendor/archify/` + `report --renderer archify`；失败回退 builtin | 3–4 天 | **Phase 2**（A 稳定后） |
| C. 生态数据源 | `archify-trace` skill + 上游 issue | 1–2 天 | **Phase 3** |
| D. DSH 插件分发 | `@<scope>/architecture-viewer-dsh` Skill-only bundle，进 DeepSeek Harness 生态 | 1–1.5 天 | **Phase 3**（机会性，不阻塞主线） |

模式 A 即使不 vendor 也成立：用户 Chat 已装 archify skill 时，Agent 拿我们的 sparse IR 去 `deliver`/`compare`。模式 B 只对「已通过 validate 的稀疏 IR」自动出图。模式 D 把我们的**分析/门禁能力**（不是渲染）包成 DSH Skill provider，覆盖 DeepSeek 国内 Agent 用户；渲染可与 `@tt-a1i/archify-dsh` 组合（我们出事实 + IR，archify 出图）。

## 六、分阶段实施

### Phase 0 · 本周（约 0.5 天，不依赖 Archify）

| # | 任务 | 验收 | 工时 |
|---|---|---|---|
| 0.1 | `diff-graph` 增加 moved / rerouted（我们自己的语义，供报告文案；与 Archify 字段同名但独立） | 单测覆盖 | 3h |
| 0.2 | session-report golden 测试 | 3 fixture | 2h |
| 0.3 | WBS 录入 W03 集成任务卡 | cards 生成 | 0.5h |

### Phase 1 · 模式 A —— **已完成**

| # | 任务 | 状态 |
|---|---|---|
| 1.1 | Spike | **完成** |
| 1.2 | `lib/export-archify.js` | **完成** |
| 1.3 | CLI `arch-viewer archify-export` | **完成**（命令名如此，非 export-archify） |
| 1.4 | MCP `av_archify_export` | **完成** |

### Phase 2 · 模式 B —— **核心完成，vendor 入库未做**

| # | 任务 | 状态 |
|---|---|---|
| 2.x | `tryRenderArchify` / `finalizeSessionHtml`；`session report --renderer auto` | **完成**；失败回退内置；本仓实测 Archify 主 HTML |
| 2.1 | `vendor/archify/` 钉版本入库 | **未做**（工作区仅有未跟踪的 `archify-main/`） |
| 2.5 | 默认 renderer | 现为 **auto + 永久 fallback**（不必再改回默认 builtin） |

### Phase 3 · 模式 C + D + 定位文案 —— **未开始**

`archify-trace` skill、上游 issue、README「架构验收门」、DSH 插件——等 0.12 提交后再做。

**模式 D · DSH 插件（参考 Archify 已落地的 `@tt-a1i/archify-dsh@0.1.0`）**

Archify 的 DSH 集成是现成范本：`integrations/deepseek-harness/`（适配器 `lib/index.js` + `scripts/pack.mjs` 打包 + 契约测试 + `.github/workflows/dsh.yml` 三条流水线：adapter contract / distribution acceptance / 跨平台 release gate）。关键事实：

- **形态**：Skill-only bundle，注册一个 filesystem Skill provider；**不**注册原生工具、不起 Web client、无 telemetry/network/credentials、无 `prepare/install/postinstall` 钩子，host 侧适配代码不 spawn 进程。
- **分发**：走 **npm**（与主 skill 的 GitHub-only 不同），`dsh plugin --profile web add @<scope>/architecture-viewer-dsh@x.y.z`；release 不可变，从 git tag 重建 payload。
- **运行环境约束**：目标 `@deepseek-ai/dsh@0.1.0-rc.6`（**developer-preview，无跨版本稳定承诺**），Node `^22.19.0 || >=24.0.0`。
- **Produced Files 限制**：shell 命令产出的文件不会自动进 DSH Web 产物条；skill 文案必须让 agent **回传 JSON/HTML 的精确工作区路径**。

| # | 任务 | 验收 | 工时 |
|---|---|---|---|
| 3.D.1 | `integrations/dsh/` 适配器：filesystem Skill provider 暴露我们的 CLI（scan / session report / risk / archify-export），skill 文案教 DSH agent 走「分析→门禁→（可选）导出 IR」 | 本地 `dsh plugin add` 后 agent 能跑通会话门 | 0.5 天 |
| 3.D.2 | `pack.mjs` 打包 + npm scoped 包（scope 待定；Archify 用 `@tt-a1i`）；payload 从 git tag 不可变重建 | tarball-contract 测试过 | 0.25 天 |
| 3.D.3 | 安全契约测试：无 install 钩子 / 无 telemetry / 无网络 / 不 spawn；distribution acceptance（真装→发现→smoke→卸载） | 仿 `dsh.yml` 的 CI 绿 | 0.5 天 |
| 3.D.4 | README + 集成 README（注明**社区集成、非 DeepSeek 官方**；Node 版本；Produced Files 路径回传约定） | 文档齐 | 0.25 天 |

**前置**：建议在 2.1（vendor 钉版本）之后做，bundle 才能自带渲染、离线自洽；否则 DSH 用户需另装 archify。**定位**：机会性分发，DSH 尚在 rc，不阻塞 W02 账号主线。

## 七、风险与对策（修订）

| 风险 | 等级 | 对策 |
|---|---|---|
| clean-flow 导致密集图无法 render | **高** | 默认稀疏；分层 grid + side；超限降 `layers`；失败回退 builtin |
| id 清洗碰撞（两 path 清洗成同一 id） | 中 | 碰撞时追加短 hash 后缀；单测覆盖 |
| Archify 迭代快（2.17-dev） | 中 | 钉版本 vendor；只用稳定字段 |
| sources/repository 误开 | 低 | 默认不写 sources |
| 渲染被外部卡脖子 | 低 | builtin 永久 fallback；IR 是我们的资产 |
| DSH 尚在 developer-preview（rc.6，无跨版本承诺） | 低 | 模式 D 定位机会性分发、不阻塞主线；release 钉 tag 不可变；DSH 升级失效时下架对应版本即可 |

## 八、待拍板（余下）

1. `archify-main/` **不要**整目录进产品 commit；正式离线用日后钉版本的 `vendor/archify/`。
2. 默认 renderer：已落地 **auto + fallback**，建议维持，观察一周。
3. `archify-trace` 品牌挂 Architecture Viewer（Phase 3）；DSH 包名/npm scope 待定（模式 D，需先注册 npm org，可与账号体系的命名一起拍）。
4. W02-06 账号骨架：建议 **先提交 0.12 候选再开**。

## 九、建议下一步

见 `pm/reports/STATUS-2026-09-04.md` 第二节。优先：**拆 commit 提交集成（不含 archify-main）→ 写 0.12.0 Unreleased → 周一校准 W02 卡面。**
