# 架构图使用教程

默认入口是 **Block 分层模块图**（静态结构总览，不是运行时真相）。C4 / 类图 / 部署是按需或兼容视图：源文件不存在时页面会隐藏对应 Tab。

讲解用的成片图请在核对会话报告证据后导出 Archify（`archify-export --confirm` / `av_archify_export` 的 confirm=true）。日常评审看 `.av/session-report.html` 的 Before / Delta / After。

## 启动

```bash
cd architecture_viewer
python -m http.server 8080
# 浏览器打开 http://localhost:8080/architecture_visualized.html
```

集成到其他页面的做法见 [README.md](README.md) 和 [sample-usage.html](sample-usage.html)。

---

## 场景一：新人上手（10 分钟了解项目全貌）

按编号顺序浏览，每张图看第一个子图即可：

| 顺序 | Tab | 看什么 |
|:---:|-----|--------|
| ① | 🗺️ C4 Context | 系统在环境中的位置：谁在用、依赖哪些外部系统 |
| ② | 📦 Block Diagram | 模块分层：前端 → API → 业务 → 数据 → 监控 → 基础设施 |
| ③ | 🏠 C4 Container | 内部有哪些服务/进程，请求和数据怎么流动 |

看完这三张，可以对「是什么、有哪些模块、数据怎么流」建立基本概念。

---

## 场景二：日常运维（出问题时快速定位）

| 运维场景 | 看哪个 Tab | 具体看什么 |
|---------|-----------|-----------|
| 系统不工作了 | 🚀 Deploy & Ops | 进程拓扑：哪个进程没跑、启动顺序对不对 |
| 数据不对 | 🚀 Deploy & Ops | 数据资产：关键路径、谁写谁读 |
| 健康检查失败 | 🚀 Deploy & Ops | 探活地址、级联依赖 |
| 不确定模块关系 | 🏠 C4 Container | 容器地图 + 数据流全景 |

---

## 场景三：开发参考（改代码时对照）

| 开发任务 | 看哪个 Tab | 参考内容 |
|---------|-----------|---------|
| 改某个服务内部实现 | 🔧 C4 Component | 容器内部组件和调用关系 |
| 新增类 / 重构 | 💻 Class Diagram | 类继承、接口、跨模块依赖 |
| 新增模块 | 📦 Block Diagram | 确认应该放在哪一层 |
| 改调度 / 网关 / 监控 | 🔧 C4 Component 或 🏠 C4 Container | 对应容器及其上下游 |

---

## 兼容视图（非默认）

源文件存在时仍可打开这些 Tab；没有文件时页面会隐藏它们。不要把自动生成的 C4 双图当成运行时进程图。

| Tab | 视角 | 适合 |
|-----|------|------|
| 🗺️ C4 Context | 系统与外部世界 | 产品、新人 |
| 🏠 C4 Container | 内部容器与数据流 | 架构、运维 |
| 🔧 C4 Component | 容器内部组件 | 开发者 |
| 📦 Block Diagram | 分层全景 | 全角色 |
| 💻 Class Diagram | 类与依赖 | 开发者 |
| 🚀 Deploy & Ops | 进程、配置、数据、探活 | 运维 |

子图数量由对应 `.md` 里的 `##` 标题决定，接入项目后可以按需增减。

---

## 交互操作

| 操作 | 方式 |
|------|------|
| 切换主视图 | 顶部 Tab 按钮 |
| 切换子图 | 主 Tab 内的子 Tab |
| 缩放 | Ctrl + 滚轮，或 🔍+ / 🔍- |
| 平移 | 拖拽画布空白处 |
| 全屏 | ⛶ |
| 从源文件刷新 | 🔄 |
| 下载 PNG | 💾 |
| 搜索模块 | 画布上方搜索框 |
| 聚焦模块 | 点击节点；再次点击空白处取消 |

功能可通过 `architecture.config.js` 的 `features` 逐项关闭。
