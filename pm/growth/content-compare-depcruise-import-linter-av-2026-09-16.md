# AI 合入前怎么拦跨层？dependency-cruiser / Import Linter / Architecture Viewer 怎么选

> **状态：草稿 / 待润色发布** | 面向 Juejin / 知乎 | 2026-09-16

---

## 一句话定位

AI 改完 500 行代码，单测全绿——但你怎么确认它**没把 Controller 直连 DB、没跨层 import、没架构漂移**？

本文对比三种常见架构约束工具在 **AI 编码场景**下的适用性、配置成本、误报风险与接入摩擦。

---

## 核心区别速览

| 工具 | 定位 | 检查时机 | 适合场景 | 配置复杂度 | 误报风险 |
|---|---|---|---|---|---|
| **dependency-cruiser** | 全量依赖规则静态检查 | 每次 CI 全仓扫描 | 严格分层规范的大型项目 | 中–高（需写完整规则 JSON） | 中（需精细调规则避免噪音） |
| **Import Linter** | Python 专用层级约束 | 每次 CI / pre-commit | Python 单体 / 微服务分层 | 低–中（TOML 简洁声明） | 低–中（仅 Python，误报少） |
| **Architecture Viewer** | **增量结构变更门** | 对照 git HEAD 检查**本次改动** | AI 跨文件改码后验收增量风险 | 低（最小化 `.av/layers.json`） | 低–中（仅针对新增关系） |

**关键差异：**

- **dependency-cruiser / Import Linter** = 全量检查，每次 CI 扫全仓，发现**所有违规**（包括历史遗留）。
- **Architecture Viewer** = **增量检查**，只看**本次 commit / PR 新增了什么**，历史遗留不报（除非你改到它）。

---

## 1. dependency-cruiser：JS/TS 全生态的规则引擎

### 适合什么场景

- **严格分层规范已落地**：团队有明确的"禁止 controller → repository"等书面约定。
- **Node.js / TypeScript 中大型项目**：需要同时管理 ESM / CommonJS / TypeScript paths。
- **CI 强制执行**：容忍每次全仓扫描（几秒到几十秒，取决于仓库规模）。

### 配置示例

```json
{
  "forbidden": [
    {
      "name": "no-controller-to-db",
      "from": { "path": "^src/controllers" },
      "to": { "path": "^src/database" },
      "comment": "Controllers must not directly access database layer"
    }
  ]
}
```

### 接入摩擦

- ✅ **文档完善**，社区成熟（npm 周下载 8 万+）。
- ✅ 支持 `--output-type err-only` 简化输出。
- ⚠️ **规则语法学习成本**：正则路径匹配 + `pathNot` / `reachable` 等高级用法需要反复调试。
- ⚠️ **历史债务一次性暴露**：首次运行可能报出几十条遗留问题，需逐一豁免或修复。
- ⚠️ **不区分增量与存量**：即使本次 PR 没改分层，只要历史有违规，CI 就红（除非配置 `--ignore-known`）。

### AI 编码场景下的挑战

1. **AI 改了 10 个文件，但 CI 报了 30 条错**——其中 20 条是历史遗留，10 条是本次新增，需人工分辨。
2. **路径重构 / 重命名频繁**：AI 喜欢「优化目录结构」，每次改路径就要同步更新 `.dependency-cruiser.json` 规则。
3. **false positive 调试循环长**：改规则 → 跑 CI → 等 3 分钟 → 发现还有误报 → 再改规则。

---

## 2. Import Linter：Python 分层的轻量选择

### 适合什么场景

- **Python 专用**：Django / FastAPI / Flask 等单体或微服务。
- **TOML 配置即可**：团队熟悉 `pyproject.toml`，不想写复杂 JSON。
- **已有 pre-commit 流程**：可挂在 `pre-commit` 钩子上秒级检查。

### 配置示例

```toml
[[tool.importlinter.contracts]]
name = "No controller to database"
type = "forbidden"
source_modules = ["myapp.controllers"]
forbidden_modules = ["myapp.database"]
```

### 接入摩擦

- ✅ **配置简洁**，5 行 TOML 即可上手。
- ✅ **Python 生态原生**，pip 安装无额外依赖。
- ⚠️ **仅限 Python**：多语言项目（如前端 TS + 后端 Python）需额外工具。
- ⚠️ **同样是全量检查**：不区分本次改动与历史遗留。
- ⚠️ **动态 import 支持有限**：`importlib.import_module()` 等运行时导入可能漏检。

### AI 编码场景下的挑战

1. **AI 生成的"聪明"动态导入**：例如 `__import__(f"myapp.{layer}.{module}")`，静态分析工具难以追踪。
2. **历史问题干扰**：同 dependency-cruiser，首次运行可能暴露存量违规，需要先清理或豁免。
3. **跨语言项目无解**：前端 React + 后端 Python 时，Import Linter 只能管后端。

---

## 3. Architecture Viewer：AI 改码后的增量结构门

### 适合什么场景

- **AI 日常跨文件改码**：Cursor / Copilot / Claude 经常一次改 5–20 个文件。
- **想快速验收「这次有没有跨层」**：不关心历史债务，只要这次改动别引入新坑。
- **本地 + CI 双模式**：开发时 `npx` 秒跑，CI 里同一命令 exit code 判断通过/失败。
- **Python / JS / TS / Go 等多语言混合仓库**：基于 AST 和文件路径推断,不限单一语言。

### 核心定位（非替代关系）

**Architecture Viewer ≠ 测试 ≠ Linter ≠ 业务逻辑审查**

它只回答一个问题：

> **对照 git HEAD，这次改动新增了哪些结构关系（依赖边、调用边），有没有违反你的分层规则？**

- ✅ **绿灯** = 没有新增结构违规（不代表代码正确、不代表业务逻辑对）。
- 🔴 **红灯** = 检测到新增跨层依赖 / 层级穿透（例如 controller 直接 import database）。

**它不做什么：**

- ❌ 不检查业务逻辑正确性。
- ❌ 不替代单元测试 / 集成测试。
- ❌ 不做类型检查 / 语法校验（交给 TypeScript / mypy / ESLint）。
- ❌ 不管历史遗留问题（除非你在本次改动里修改了相关文件）。

### 配置示例

最小化 `.av/layers.json`：

```json
{
  "app/controllers": "controller",
  "app/services": "service",
  "app/database": "storage"
}
```

加禁令 `architecture-rules.yaml`：

```yaml
version: 1
forbid_cross_layer:
  - id: no-controller-to-storage
    from: controller
    to: storage
    message: 控制层不得绕过服务层直接访问存储层
```

### 接入摩擦

- ✅ **零安装试用**：`npx --yes arch-viewer@0.12.2-rc.6 session report .` 即跑，本地不留文件。
- ✅ **增量 diff 模式**：只报本次新增关系，历史债务不干扰（首次运行即适用真实 PR）。
- ✅ **退出码清晰**：`0` = 通过，`1` = 结构红灯（非安装失败），CI 脚本一行判断。
- ⚠️ **早期 RC 版本**：当前试点版本 `0.12.2-rc.6`，文档和边界 case 仍在完善。
- ⚠️ **需手动定义层级**：`.av/layers.json` 必需（否则默认推断为 reportOnly 中等风险,不阻断）。
- ⚠️ **不处理运行时动态加载**：反射 / 插件系统等运行时依赖无法静态分析。

### AI 编码场景下的优势

1. **AI 改了 10 个文件，报告只看这 10 个**：历史遗留的 100 条依赖不出现在本次报告里。
2. **本地秒验收**：改完代码 → `npx arch-viewer session report .` → 3 秒看结果 → 红了就撤销 → 绿了再 commit。
3. **配置即规范文档**：`.av/layers.json` + `architecture-rules.yaml` 本身就是团队分层约定的可执行版本,不需要额外维护 Confluence 文档。

### 误报风险与处理

- **误报来源**：
  - 测试文件被误判为业务代码（可在 `architecture-rules.yaml` 里豁免 `test/` 路径）。
  - 动态导入 / 字符串拼接的模块路径（静态分析工具通病）。
  - 依赖推断基于 AST，复杂宏 / 元编程可能误判。

- **处理策略**：
  - 第一次红灯人工复核（看报告里的文件名 + 行号）。
  - 确认误报后在规则里加 `except` 路径。
  - 真实违规则要么修代码,要么团队讨论后允许例外并注释原因。

---

## 对比总结表

| 维度 | dependency-cruiser | Import Linter | Architecture Viewer |
|---|---|---|---|
| **语言支持** | JS/TS (Node.js) | Python only | Python/JS/TS/Go 等（基于 AST） |
| **检查范围** | 全量（每次全仓） | 全量（每次全仓） | **增量**（仅本次改动） |
| **历史债务** | 一次性暴露 | 一次性暴露 | **不报**（除非本次改到） |
| **配置复杂度** | 中–高（JSON 规则 + 正则） | 低–中（TOML 简洁） | 低（`.av/layers.json` 路径映射） |
| **首次接入成本** | 需先清理或豁免存量问题 | 需先清理或豁免存量问题 | **可直接用于真实 PR** |
| **CI 执行时间** | 几秒到几十秒（全仓扫描） | 几秒（Python 项目） | 3–10 秒（增量 diff） |
| **误报调试** | 改规则 → 等 CI → 再改 | 改 TOML → 本地跑 → 再改 | 本地秒验 → 加豁免 → 秒验 |
| **AI 改码适配** | ⚠️ 全量报告需人工分辨 | ⚠️ 全量报告需人工分辨 | ✅ 只看本次,干扰少 |
| **社区成熟度** | ⭐⭐⭐⭐⭐ 成熟（npm 8w+/周） | ⭐⭐⭐ 稳定（Python 生态认可） | ⭐ 早期试点（RC 阶段） |

---

## 实战案例：红→绿演示（2 分钟复现）

**场景：** AI 在 controller 里「优化」了一段逻辑，直接 import 了 database 层，绕过 service 层。

1. **基线代码（绿灯）**：controller → service → database，符合分层。
2. **AI 改动**：在 `order_controller.py` 里加了 `from app.database.orders_repo import OrdersRepository`。
3. **运行检查**：

```bash
npx --yes --package arch-viewer@0.12.2-rc.6 arch-viewer session report /absolute/path/to/repo
```

4. **输出红灯（退出码 1）**：

```
🔴 [HIGH] 层级穿透: 控制器 直接访问 存储，跳过了服务层
     order_controller.py → orders_repo.py (import)
```

5. **撤销违规改动**：`git checkout app/controllers/order_controller.py`
6. **再次运行**：

```
✅ 架构验收门通过：退出码 = 0
```

**完整脱敏样例（含 `.av/layers.json` 和 `architecture-rules.yaml` 配置）：**

👉 https://github.com/tomyangod/architecture_viewer/blob/main/pm/growth/red-green-sample.md

---

## 怎么选？三个决策问题

### 1. 你们现在合入前靠什么确认没跨层？

- **人工 Code Review** → 考虑 **Architecture Viewer** 作为增量门，减少人工负担。
- **全量 Linter（dependency-cruiser / Import Linter）已落地且运行良好** → 继续用，不需要换。
- **有 Linter 但 CI 噪音大 / 历史债务清不完** → 可尝试 **Architecture Viewer 增量模式** + 原 Linter 并行,逐步过渡。

### 2. AI 改码频率有多高？

- **每天 / 每周多次**，且 AI 经常跨文件改 → **Architecture Viewer** 增量验收价值高。
- **偶尔用 AI**，主要还是人工写 → 全量 Linter 足够。

### 3. 团队能接受的配置复杂度？

- **愿意投入时间调规则、清理历史债务** → dependency-cruiser（功能最全）。
- **Python 单体,要求配置简洁** → Import Linter。
- **快速试错、本地秒验、不想先清历史债** → Architecture Viewer（最低摩擦）。

---

## 试用 Architecture Viewer（零安装,3 秒出结果）

**请钉死试点版本**（不要用 `@latest`,当前 latest 0.12.1 不含最新修复）：

```bash
npx --yes --package arch-viewer@0.12.2-rc.6 arch-viewer session report /absolute/path/to/repo
```

**前置条件：**

- Node.js ≥ 18
- 仓库已 `git init` 且有至少一次 commit
- 可选：配置 `.av/layers.json`（否则默认推断为 reportOnly 中等风险）

**轻互动 CTA（L1/L2,非强制）：**

1. **L1 一句话反馈**：你们现在合入前靠什么确认没跨层？（回复"人工 review" / "dependency-cruiser" / "没管" / 其他工具都行）
2. **L2 零承诺试用**：如果你最近有 AI 改过的 PR,跑一次上面的命令看红绿灯准不准——可以直接回复结果（红了 / 绿了 / 报错了），我们会根据真实场景改进工具。

**无需承诺 15 分钟会议；无需提交代码；随时可停。**

---

## 声明

- **本文基于 2026-09-16 试点阶段现状**，Architecture Viewer 当前为 RC 版本，部分功能和文档仍在完善。
- **不虚构下载量 / 客户案例**：上述对比基于工具公开文档和试点演示,dependency-cruiser / Import Linter 的周下载量来自 npm / PyPI 公开数据。
- **不声称替代关系**：三种工具定位不同,可根据场景组合使用（例如 Architecture Viewer 增量门 + dependency-cruiser 定期全量审计）。

---

**草稿状态：待润色发布** | 字数：约 2400 字 | 面向 Juejin / 知乎技术社区
