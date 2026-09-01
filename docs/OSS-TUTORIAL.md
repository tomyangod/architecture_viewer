# 开源项目实战攻略：用 Architecture Viewer 画分层架构

本教程用 **4 个仓库**走完同一条链路：克隆 → Init → Generate → 看分层图 →（可选）精修。  
不需要 DeepSeek Key；Cursor 扩展和 CLI 共用 `lib/`。

已在本机跑通（2026-08-29）：内置 Coffee Shop、[Uptime Kuma](https://github.com/louislam/uptime-kuma)、[listmonk](https://github.com/knadh/listmonk)、[changedetection.io](https://github.com/dgtlmoon/changedetection.io)。

---

## 0. 你要准备什么

| 项 | 要求 |
|----|------|
| 本仓库 | `/Users/yanheyang/Desktop/architecture_viewer`（下文记为 `$AV`） |
| Node | ≥ 18 |
| Git | 能 `git clone --depth 1` |
| 浏览器 | 看图；不要用 `file://` 直接打开 HTML |

设环境变量，后面命令都能复制：

```bash
export AV="$HOME/Desktop/architecture_viewer"   # 按你的实际路径改
export LAB="$HOME/Desktop/arch-viewer-labs"      # 实验仓放这里，勿放进 $AV
mkdir -p "$LAB"
cd "$AV"
```

**通解提醒**：`generate` 会扫描目标仓并**覆盖** `architecture_viewer/` 下 6 个 `.md`。官方演示仓 `examples/showcase-shop` 里的图是手写精修稿，**不要**直接对其 generate；请先复制到 `/tmp` 或 `$LAB`。

---

## 1. 通用四步（每个开源仓都做这一遍）

```text
① git clone --depth 1 <repo>
② node $AV/lib/cli.js init <repo路径>
③ node $AV/lib/cli.js generate <repo路径>
④ 预览分层图 + check
```

**Init**：把 Viewer 套件拷进目标仓的 `architecture_viewer/`（HTML、config、AGENT.md、空/模板 md、离线 mermaid）。  
**Generate**：扫描 compose / 目录 / 入口 / 关键文件 → 写出六视图；**分层模块**走 `lib/layers.js`（彩色 subgraph）。

### 1.1 预览（三选一）

**A. 本地 HTTP（最稳）**

```bash
cd <repo路径>/architecture_viewer
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080/architecture_visualized.html?tab=block
```

默认请看 **「分层模块 / Block」** Tab。C4 更素，那是建模视图，不是附件那种分层图。

**B. Cursor / VS Code 扩展**

1. Cursor 打开 **`$AV` 本仓库**，按 **F5** 启动 Extension Development Host  
2. 新窗口 **打开目标开源仓根目录**（不是 `$AV`）  
3. 命令面板：`Architecture Viewer: Init Kit` → `Generate` → `Preview`  
4. Preview 里切到 Block

**C. 网页版（本机路径）**

```bash
cd "$AV"
ARCH_WEB_PATH_MODE=1 npm run web
# 落地页填绝对路径生成；或 curl POST /api/generate { "path": "..." }
```

### 1.2 校验

```bash
node "$AV/lib/cli.js" check <repo>/architecture_viewer --filled --drift --repo <repo>
```

漂移 = compose 服务名 / 模块名没出现在任何一张图里。骨架图一般能过；精修后也要再 check。

### 1.3 看图时先看什么

1. 打开后立刻切 **Block / 分层模块**  
2. 彩色大框 = 层（前端粉、API 紫、调度橙、Worker 绿、存储青、监控黄、运维绿）  
3. 节点是「图标 + 中文名 + 文件/技术」  
4. 空层不会出现（例如没有 Worker 目录就不会画采集层）

---

## 2. 实验 A · Coffee Shop（本仓库自带，5 分钟）

**为什么选它**：目录名就是 `frontend` / `backend` / `worker` / `deploy`，compose 里还有 postgres、redis、mq。规则生成最接近「一眼分层」。

**不要**在 `examples/showcase-shop` 上 generate（会盖掉手写稿）。

```bash
rm -rf "$LAB/showcase-shop"
cp -R "$AV/examples/showcase-shop" "$LAB/showcase-shop"

node "$AV/lib/cli.js" init "$LAB/showcase-shop"
node "$AV/lib/cli.js" generate "$LAB/showcase-shop"
node "$AV/lib/cli.js" check "$LAB/showcase-shop/architecture_viewer" \
  --filled --drift --repo "$LAB/showcase-shop"

cd "$LAB/showcase-shop/architecture_viewer"
python3 -m http.server 8081
```

打开：http://127.0.0.1:8081/architecture_visualized.html?tab=block

**你应看到的层**

| 层 | 典型节点 |
|----|----------|
| 前端 | `frontend/`、`index.html`、`app.js` |
| API | `backend/`、`main.py`、compose `api` |
| Worker | `worker/`、`worker.py` |
| 存储 | `redis`、`mq`（compose） |
| 运维 | `deploy/` |

对照手写精修版（不要覆盖）：http://127.0.0.1:3847/samples/showcase/?tab=block（先 `cd $AV && npm run web`）。

**学到什么**：规则生成能分层、能贴文件名；「顾客 / 支付网关 / 出杯通知」这种业务叙事要靠 Cursor 或 `architecture.layers.json` 补。

---

## 3. 实验 B · Uptime Kuma（监控看板）

仓库：https://github.com/louislam/uptime-kuma  
适合：前端 SPA + Node 服务 + SQLite + 心跳探测 + 告警，对应 **监控层**。

```bash
cd "$LAB"
git clone --depth 1 https://github.com/louislam/uptime-kuma.git

node "$AV/lib/cli.js" init "$LAB/uptime-kuma"
node "$AV/lib/cli.js" generate "$LAB/uptime-kuma"
```

纯规则扫描会把 `server/`、`src/`、`index.html` 画出来，但顶层还有 `extra/`、`public/serviceWorker.js` 等，**容易挤进前端层**。这是扫描启发式的边界，不是你操作错了。

**精修（推荐抄这份覆盖文件）**

```bash
cp "$AV/docs/oss-labs/uptime-kuma.layers.json" "$LAB/uptime-kuma/architecture.layers.json"
node "$AV/lib/cli.js" generate "$LAB/uptime-kuma"
```

覆盖后分层图会变成：看板 → HTTP API → SQLite → 心跳/告警 → Compose。再预览：

```bash
cd "$LAB/uptime-kuma/architecture_viewer"
python3 -m http.server 8082
# http://127.0.0.1:8082/architecture_visualized.html?tab=block
```

**Cursor 精修 C4（可选）**：在 Cursor 打开 `$LAB/uptime-kuma`，Chat 贴：

```
@architecture_viewer/AGENT.md 是生成器规范。请扫描仓库根的
源码、package.json、compose.yaml、server/、src/，按 AGENT.md
覆写 architecture_viewer 下 6 个 .md。先给 Mermaid 草稿再写盘。
从 c4-container.md 开始，最后做 c4-context.md。不要改 HTML。
分层图优先：监控看板 / API / SQLite / 心跳探测 / 告警通知。
```

---

## 4. 实验 C · listmonk（Go 邮件订阅）

仓库：https://github.com/knadh/listmonk  
适合：`frontend/` + `cmd/main.go` + Postgres compose + Dockerfile，**前后端分离 + 存储 + 交付** 很清晰。

```bash
cd "$LAB"
git clone --depth 1 https://github.com/knadh/listmonk.git

node "$AV/lib/cli.js" init "$LAB/listmonk"
node "$AV/lib/cli.js" generate "$LAB/listmonk"
```

规则生成已经能画出：frontend、app/cmd、db(postgres)、Dockerfile。README 第一行 `#` 可能被当成项目标题（例如 compose 说明），预览页标题会怪——改 `architecture_viewer/architecture.config.js` 里 `USER_CONFIG.project.title` 即可。

**精修覆盖**

```bash
cp "$AV/docs/oss-labs/listmonk.layers.json" "$LAB/listmonk/architecture.layers.json"
node "$AV/lib/cli.js" generate "$LAB/listmonk"

cd "$LAB/listmonk/architecture_viewer"
python3 -m http.server 8083
# http://127.0.0.1:8083/architecture_visualized.html?tab=block
```

**你应看到的层**：管理后台 → listmonk API（`:9000`）→ Postgres → Compose/镜像。

---

## 5. 实验 D · changedetection.io（最接近附件那种「采集系统」）

仓库：https://github.com/dgtlmoon/changedetection.io  
适合：Flask API + 队列调度 + Playwright 抓取 Worker + 快照存储 + SMTP/Webhook 通知。层结构和舆情监控附件同类。

```bash
cd "$LAB"
git clone --depth 1 https://github.com/dgtlmoon/changedetection.io.git

node "$AV/lib/cli.js" init "$LAB/changedetection.io"
node "$AV/lib/cli.js" generate "$LAB/changedetection.io"
```

第一次 generate 就会标出 `flask_app.py`、`worker.py`、`worker_pool.py`、Dockerfile。顶层包名是 `changedetectionio/`（扫描白名单里没有这个目录名），所以 **前端页、通知模块要靠 layers.json 补**。

```bash
cp "$AV/docs/oss-labs/changedetection.layers.json" \
   "$LAB/changedetection.io/architecture.layers.json"
node "$AV/lib/cli.js" generate "$LAB/changedetection.io"

cd "$LAB/changedetection.io/architecture_viewer"
python3 -m http.server 8084
# http://127.0.0.1:8084/architecture_visualized.html?tab=block
```

**覆盖后你应看到 7 层**（有节点才画）：展示 → API → 调度队列 → 采集 Worker/Playwright → 快照存储 → 变更通知 → Docker。

这就是通解的用法：**规则扫描打底 → `architecture.layers.json` 对齐真实业务层**。不必为每个仓改 `lib/`。

---

## 6. 可选：DeepSeek 只重生分层图

仅当目录命名乱、你想让模型写中文业务名时：

```bash
export DEEPSEEK_API_KEY='sk-你的密钥'
# 在 https://platform.deepseek.com 创建

node "$AV/lib/llm-generate.js" "$LAB/changedetection.io" --only block-diagram.md
node "$AV/lib/cli.js" check "$LAB/changedetection.io/architecture_viewer" \
  --filled --drift --repo "$LAB/changedetection.io"
```

密钥不要写进仓库。Cursor Chat + `AGENT.md` 通常够用，不必接 API。

---

## 7. 自己仓库怎么套这条攻略

把上面的 `<repo>` 换成你的路径即可，例如舆情监控：

```bash
node "$AV/lib/cli.js" init /path/to/publicopinionmonitor_v2
node "$AV/lib/cli.js" generate /path/to/publicopinionmonitor_v2
# 对照附件：在仓库根写 architecture.layers.json
# titles.schedule = 调度核心层，titles.worker = 采集层，……
node "$AV/lib/cli.js" generate /path/to/publicopinionmonitor_v2
```

`architecture.layers.json` 字段说明见 [LAYERED-STYLE.md](LAYERED-STYLE.md)，完整示例见 [../templates/architecture.layers.example.json](../templates/architecture.layers.example.json)。

---

## 8. 对照表：四个仓各自证明什么

| 实验 | 仓库 | 规则生成够不够 | 建议下一步 |
|------|------|----------------|------------|
| A | Coffee Shop（内置） | 层已经齐 | 对比 `/samples/showcase/` 手写稿 |
| B | Uptime Kuma | 能出 SPA+server，杂文件易误入前端 | 用 `docs/oss-labs/uptime-kuma.layers.json` |
| C | listmonk | frontend / Go / Postgres / Docker 清楚 | 改标题 + 可选 layers.json |
| D | changedetection.io | Worker/API 能扫到，缺展示/监控层名 | **必用** layers.json，最像附件 |

---

## 9. 常见问题

**Q: 图还是丑 / 挤？**  
先确认 Tab 是 Block 不是 C4 Context。节点太多时用 `architecture.layers.json` 的 `nodes` **白名单**（只保留 6～10 个关键块），不要让扫描把 `extra/` 全画上。

**Q: generate 把我精修的 md 盖掉了？**  
这是预期行为。精修请用 git。官方 showcase 请只 check、不要 generate。

**Q: `file://` 打不开图？**  
浏览器拦截对 `.md` 的 fetch。用 `python3 -m http.server` 或扩展 Preview。

**Q: check 报 DRIFT？**  
compose 服务名必须出现在六视图某张图的文本里。layers.json 的 `nodes.id` / `sub` 里写上服务名即可。

**Q: 要不要给这些开源仓提 PR 带上 architecture_viewer/？**  
实验仓在 `$LAB`，不要把生成目录提交回别人的上游。自己的产品仓才适合把套件提交进 Git。
