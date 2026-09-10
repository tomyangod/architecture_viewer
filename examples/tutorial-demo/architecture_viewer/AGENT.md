# 架构生成器规范（给 Cursor / Swark / 任意 LLM Agent）

> 本目录是一个「项目架构可视化脚手架」。
> 你的任务：扫描上级目标仓库，把 6 个 .md 文件按本规范填满 Mermaid 代码。
> **不要改 HTML、不要改 architecture.config.js、不要新建其他文件。**

## 渲染协议（必须遵守）
1. 每个 .md 文件由若干「## 子图N：标题」+ 紧跟其后的 ```mermaid 代码块 组成。
2. viewer 用正则 /```mermaid\s*\n([\s\S]*?)```/g 提取代码块，标题用作子图卡片标题。
3. Mermaid 版本为 11，支持 C4Context / C4Container / C4Component / flowchart / classDiagram。
4. 节点 ID 用英文 snake_case（如 svc_auth、db_primary），label 可中文。
5. C4 图里所有 Rel 引用的实体必须先声明（Person / System / Container / ...）。
6. 每个视图推荐 2 张子图，避免单图过大；如内容多可增至 3 张。
7. **填完后删除** Init 模板页脚 `*模板文件 · 请替换为你项目的实际内容*`（`check --filled` 会因该行失败）。

## 6 个 .md 的填入要求
| 文件 | 视图 | 内容来源 | Mermaid 类型 |
|------|------|---------|-------------|
| c4-context.md | 系统全景 | README、产品文档、外部依赖清单 | C4Context |
| c4-container.md | 容器视图 | docker-compose.yml、Dockerfile、服务目录、端口 | C4Container |
| c4-component.md | 组件详情 | 各服务源码的模块/类、import 关系 | C4Component |
| block-diagram.md | **分层模块（观感主视图）** | 按业务/技术分层：前端、API、采集/异步、存储、监控、交付 | flowchart TB + 彩色 subgraph |
| class-diagram.md | 类图 | 核心领域模型、继承/组合关系 | classDiagram |
| deployment-ops.md | 部署运维 | k8s manifest、CI/CD、监控配置 | flowchart TB |

## block-diagram.md 视觉规范（通解 · 任意仓库）

目标观感：彩色分层底框 + 图标节点 +「中文名 / 文件名」双行标签 + 箭头语义。
**实现入口**：`lib/layers.js`（`arch-viewer generate` 默认走这里）；本规范同时约束 Cursor / LLM。

1. 用 `flowchart TB`，每层一个 `subgraph L_xxx["🖥️ 层名"]`；**空层不画**
2. 语义层顺序（有节点才出现）：`frontend` → `api` → `schedule` → `worker` → `storage` → `monitor` → `ops`
3. 节点写法：`id["🛒 中文名<br/><small>path/or/tech</small>"]`；存储可用圆柱 `id[("💾 ...")]`
4. 层色建议（style subgraph）：
   - 前端/交互：粉 `#fce4ec`
   - API/业务：紫 `#ede7f6`
   - 调度/异步：橙 `#fff3e0`
   - 采集/Worker：绿 `#e8f5e9`
   - 存储：青 `#e0f7fa`
   - 监控：黄 `#fffde7`
   - 交付：绿 `#e8f5e9`
5. 用 `classDef` + `class` 给节点上色；箭头必须有中文标签（调用/读写/投递…）
6. **禁止**把分层图画成只有 L1→L2→L3 三个空框；节点要落到真实文件/服务名
7. 可选覆盖：仓库根 `architecture.layers.json`（见 `templates/architecture.layers.example.json`）
8. `--refine` 时 6 张图都走读仓摘要；骨架模式下「好看、一眼分层」仍优先保证 block-diagram

## deployment-ops.md 视觉规范（复用 Block 语法 · 不上编排状态机）

目标观感与 block-diagram **同构**：flowchart + 分层 subgraph + `classDef` 填色 + 图标/中文名/`<small>` 路径 + stadium 外部角色。内容视角是交付/启动，不是业务分层全景。

1. 子图1 `flowchart TB`：`L_ops`（Dockerfile / compose / Actions / 本地启动）→ `L_api`（真实入口文件）→ 有证据才画 `L_storage`；**空层不画**
2. 节点：`id["图标 中文名<br/><small>真实路径或交付物名</small>"]`；数据文件用圆柱
3. 开发者用 stadium，写在所有 subgraph 外
4. 色板：`ops #c8e6c9`、`api #ede7f6`、`storage #e0f7fa`、`actor #eceff1`
5. ops → 运行时用虚线 `-.->`；子图2 全员 stadium 短名无路径，场景是本地启动链
6. **禁止**编造 Docker/k8s；没有交付物就画本地进程

## 扫描优先级（零 API Key 即可完成）
1. 包管理器：package.json / pom.xml / go.mod / requirements.txt / Cargo.toml
2. 编排文件：docker-compose.yml、Dockerfile、k8s/*.yaml
3. 端口与配置：.env.example、config/*.yml、application.yml（**禁止读取 .env**）
4. 入口与路由：main.*、app.*、routes/、controller/
5. 模块/import：src/ 下的 import / require / from 语句
6. 数据模型：entity/、model/、domain/ 下的类/结构体

## 输出禁忌
- 禁止把 .env / 密钥 / token 写进 .md
- 禁止臆造不存在的服务名或外部系统
- 禁止改 architecture.config.js 与 architecture_visualized.html
- 禁止引入 mermaid 11 不支持的语法
- 禁止在成品图中保留 `*模板文件 · 请替换*` / `[你的项目名称]` / `用户角色A` 等占位

## 校验清单（写完每个 .md 自检）
- [ ] 所有 Rel 实体都已先声明
- [ ] 节点 ID 唯一、无重名
- [ ] C4 图含 `UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")`
- [ ] 已删除模板页脚与占位文案（`check --filled` 必须通过）
- [ ] .md 末尾有空行（避免渲染截断）
- [ ] 子图标题格式：`## 子图N：标题`（N 从 1 开始递增）

## 标题格式

viewer 认任意 `##` 标题 + 紧随其后的 mermaid 块。推荐 `## 子图N：标题`（N 从 1 递增）。单图文件也可以用 `## 分层全景` 这种描述性标题。

## 推荐工作流（给 Cursor Agent）
1. 先扫 docker-compose.yml / package.json → 填 c4-container.md（信息最确定）
2. 再扫各服务源码目录 → 填 c4-component.md
3. 扫领域模型 / entity → 填 class-diagram.md
4. 按技术分层汇总 → 填 block-diagram.md
5. 扫 k8s / 部署配置 → 填 deployment-ops.md
6. 最后综合 README + 外部依赖 → 填 c4-context.md（可叙述补充）
7. 浏览器打开 architecture_visualized.html 验证 6 张图都能渲染

## 复制到 Cursor Chat 的提示词

把本目录拷到目标项目后，在项目根打开 Chat，附上本文件：

```
@architecture_viewer/AGENT.md 是生成器规范。请扫描上级目录（本项目根）的
源码、package.json / docker-compose.yml / configs / k8s，按 AGENT.md 要求
覆写 6 个 .md 文件。每张图先给出 Mermaid 草稿，确认后再写盘。
从 c4-container.md 开始，最后做 c4-context.md。
```

## Swark 产出怎么贴进来

Swark 一次只出一张 Mermaid（多为 flowchart / classDiagram），不是 C4 全套。

1. 复制生成的 mermaid 源码（不要外层 markdown 外壳也行）
2. 贴进 `block-diagram.md` 或 `class-diagram.md` 的第一个 mermaid 块
3. 保留该文件的 `##` 标题；其余 5 张图仍用 Cursor 按本规范生成

