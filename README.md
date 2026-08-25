# 项目架构可视化脚手架

把本文件夹复制进任意项目，即可得到一套可交互的架构可视化组件（C4 / 分层模块 / 类图 / 部署运维）。

不依赖构建工具、不绑定具体业务。打开 HTML 即可使用，也可通过 iframe / URL 参数 / JS API 嵌入到文档站、后台或 Wiki。

---

## 3 步接入

1. 复制整个 `architecture_viewer/` 到目标项目（例如 `docs/architecture/`）
2. 打开 `architecture.config.js`，修改顶部的 **`USER_CONFIG`**（项目名称、主题、更新日志等）
3. 用 Cursor 或 Swark 按 [AGENT.md](AGENT.md) 覆写 6 个 `.md`，或手改模板，然后用本地 HTTP 打开：

```bash
cd architecture_viewer
python -m http.server 8080
# 浏览器打开 http://localhost:8080/architecture_visualized.html
```

> 必须通过 HTTP 访问。直接用 `file://` 打开时，浏览器会拦截对 `.md` 的 `fetch`。

集成示例见 [`sample-usage.html`](sample-usage.html)，交互说明见 [`USER_GUIDE.md`](USER_GUIDE.md)。

---

## 目录

```
architecture_viewer/
├── architecture_visualized.html   # 主入口（渲染引擎，一般不用改）
├── architecture.config.js         # 配置 + 插件 API（主要改 USER_CONFIG）
├── AGENT.md                       # 给 Cursor / Swark 的生成规范
├── .cursor/rules/                 # 打开图源 md 时自动套用规范
├── c4-context.md                  # 系统全景
├── c4-container.md                # 容器视图
├── c4-component.md                # 组件详情
├── block-diagram.md               # 分层模块
├── class-diagram.md               # 代码结构
├── deployment-ops.md              # 部署运维
├── sample-usage.html              # 4 种集成方式演示（可删）
├── README.md                      # 本文件
└── USER_GUIDE.md                  # 阅读与交互指南
```

每个 `.md` 用 `## 子图N：标题` + 一个 ` ```mermaid ` 代码块表示一张子图。HTML 会自动拆成子 Tab。

---

## 集成方式

| 方式 | 适用场景 |
|------|----------|
| 独立打开 HTML | 文档目录、给同事看架构 |
| URL 参数 `?tab=&theme=&title=` | 从其他页面深链到某一张图 |
| iframe + `embed=1` | 嵌入 Wiki / 后台 / README 预览页 |
| `ARCHITECTURE_VIEWER.createIframe()` | 编程式插入，并可 `postMessage` 切 Tab、注入图 |

父页面控制 iframe 的消息格式：

```js
iframe.contentWindow.postMessage({
  __arch_viewer__: true,
  type: 'switchTab',   // 或 download / getInfo / setMermaid / render
  tabId: 'c4-container'
}, '*');
```

---

## 用 Cursor 或 Swark 自动填图（最短路径）

渲染器不用改。生成器只要写出「`##` 标题 + mermaid 代码块」，HTML 就会渲染。规范在 [AGENT.md](AGENT.md)。

**Cursor（推荐，用登录额度，不用 API Key）**

1. 把本文件夹放到目标仓库里（例如仓库根下的 `architecture_viewer/`）
2. 在 Cursor 打开**目标仓库根目录**
3. Chat 里带上 `@architecture_viewer/AGENT.md`（或整个目录），发送 AGENT.md 末尾那条提示词
4. 先看草稿再让它写盘；然后 `python -m http.server 8080` 打开 `architecture_visualized.html`

**Swark（要 GitHub Copilot；一次一张依赖图）**

1. VS Code 安装扩展 `swark.swark`
2. 右键 `src/` → `Swark: Create Architecture Diagram`
3. 把产出的 mermaid 贴进 `block-diagram.md` 或 `class-diagram.md`
4. 其余 C4 / 部署图仍用 Cursor 按 AGENT.md 生成

把本目录拷进别的仓库后，若希望规则自动生效，把 `.cursor/rules/architecture-viewer.mdc` 再拷一份到该仓库根的 `.cursor/rules/`。

---

## 给 AI / 维护者：代码变更如何同步架构图

源码变化时，按职责更新对应 `.md`，不要改 HTML。

| 代码变化 | 更新哪张图 |
|----------|------------|
| 新增/删除用户角色、外部系统、协议 | `c4-context.md` |
| 新增/删除进程、服务、容器、数据流 | `c4-container.md` |
| 容器内部组件、模块边界变化 | `c4-component.md` |
| 分层、模块归属变化 | `block-diagram.md` |
| 类继承、接口、依赖变化 | `class-diagram.md` |
| 进程、端口、健康检查、配置、数据路径 | `deployment-ops.md` |
| 项目名称、主题、Tab 文案 | `architecture.config.js` 的 `USER_CONFIG` |

### 编辑约定

- 每个 `##` 标题对应且仅对应一个 mermaid 代码块
- C4 图中 `Rel(src, dst)` 的两端必须在同一张图里声明
- 单张子图的 `Rel()` 建议不超过约 12 条，避免挤成一团
- 改完后打开 HTML，切到对应 Tab，确认渲染无报错

### 校验脚本

在本目录执行：

```python
import re, os
files = [
    'c4-context.md','c4-container.md','c4-component.md',
    'block-diagram.md','class-diagram.md','deployment-ops.md'
]
for f in files:
    content = open(f, encoding='utf-8').read()
    blocks = re.findall(r'```mermaid\n(.*?)```', content, re.DOTALL)
    headers = re.findall(r'^## (.+)$', content, re.MULTILINE)
    if len(headers) != len(blocks):
        print(f'ERROR: {f}: {len(headers)} headers != {len(blocks)} blocks')
    for i, block in enumerate(blocks):
        declared = set()
        for m in re.finditer(
            r'(?:Person|Container|System_Ext|ContainerDb|System|Component|ComponentDb|Container_Boundary|System_Boundary)\s*\(\s*(\w+)',
            block
        ):
            declared.add(m.group(1))
        for src, dst in re.findall(r'Rel\s*\(\s*(\w+)\s*,\s*(\w+)', block):
            for name in (src, dst):
                if name not in declared:
                    print(f'ERROR: {f} sub-{i+1}: Rel({src},{dst}) → "{name}" NOT DECLARED')
```
