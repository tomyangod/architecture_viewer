# W02 任务卡 · 网页离线包 / 冒烟清单 / 账号骨架（扩展暂缓）

> 阶段：Phase 0 ｜ 周期：2026-09-07 ~ 2026-09-11 ｜ 周截止：2026-09-11
>
> 完成度：4/6 ███████░░░ 67%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w02-01"></a>⬜ W02-01 · VS Code 扩展打包脚手架（vsce） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 4h |
| 截止 | 2026-09-11 |
| 依赖 | [W01-01](../W01/README.md#w01-01)、[W01-02](../W01/README.md#w01-02) |
| 负责人 | heyangyan |
| 标签 | infra / release / deferred |


**背景**：暂缓：当前优先 CLI/MCP 方向，VS Code 扩展打包推迟到方向明确后再做。package.json 已有 publisher/commands，.vscodeignore 与 build-vsix.js 脚手架已就绪，重启时可直接用。

**目标**：（暂缓）一条命令打出可侧载的 .vsix，内容最小且完整（含 vendor/mermaid、NOTICE、LICENSE、六视图模板）。

**涉及文件**：`package.json` `.vscodeignore` `scripts/build-vsix.js` `assets/icon.png`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] node scripts/build-vsix.js（需 node_modules/.bin 在 PATH）成功产出 arch-viewer.vsix
- [ ] vsix 内包含 vendor/mermaid.min.js、NOTICE、LICENSE、六视图模板 c4-*.md/class/block/deployment-ops.md、Dockerfile
- [ ] vsix 不含 .data/、archify-main/、web/、.av/、eval/、test/、pm/（.vscodeignore 生效），体积约 9MB
- [ ] package.json 含 icon、repository、engines、categories、keywords

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  PATH="$PWD/node_modules/.bin:$PATH" node scripts/build-vsix.js && unzip -l arch-viewer.vsix | grep -q "vendor/mermaid" && ! unzip -l arch-viewer.vsix | grep -qE "archify-main|extension/\.data/|extension/web/" && echo VSIX_OK
  ```

**参考文档**：`package.json` `.vscodeignore`

**活动记录**：
  - 2026-09-04 状态变更 done→todo（暂缓）：暂缓 VS Code 扩展方向；build-vsix.js 与 .vscodeignore 脚手架已就绪保留，后续重启可直接用

---

### <a id="w02-02"></a>✅ W02-02 · 网页版可下载离线包 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | 2026-09-11 |
| 依赖 | [W01-01](../W01/README.md#w01-01) |
| 负责人 | heyangyan |
| 标签 | web / release |


**背景**：无 IDE 的评审者需要零门槛打开；下载离线包也是未来私有化交付的雏形。

**目标**：构建脚本把网页版静态产物（含内联 mermaid）打成 zip，解压后 node server.js 或直接打开即可用。

**涉及文件**：`scripts/build-web-dist.mjs` `web/server.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] node scripts/build-web-dist.mjs 产出 dist/arch-viewer-web-offline.zip（约 0.11MB）
- [ ] 解压到空目录后 node server.js 可启动并生成六视图
- [ ] zip 内无 CDN 引用（jsdelivr/unpkg/googleapis），系统字体 fallback

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node scripts/build-web-dist.mjs && test -f dist/arch-viewer-web-offline.zip && echo WEBZIP_OK
  ```

**参考文档**：`web/server.js`

**活动记录**：
  - 2026-09-04 状态变更 todo→done：校准：build-web-dist.mjs 产出 arch-viewer-web-offline.zip(0.11MB)，无 CDN，含 server.js

---

### <a id="w02-03"></a>⬜ W02-03 · Webview 离线回归与 CSP 加固 

| 字段 | 内容 |
|---|---|
| 优先级 | **P2** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 3h |
| 截止 | 2026-09-11 |
| 依赖 | [W01-01](../W01/README.md#w01-01) |
| 负责人 | heyangyan |
| 标签 | extension / security / deferred |


**背景**：暂缓：VS Code 扩展方向推迟，Webview CSP 加固一并暂缓。W01-01 离线化已消除 CDN 依赖，扩展重启时直接收紧 CSP 即可。

**目标**：（暂缓）Webview CSP 无远程域名；F5 开发宿主与侧载 vsix 两条路径断网均可 Preview。

**涉及文件**：`src/extension.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] CSP 中不含 cdn.jsdelivr / https: 通配
- [ ] 断网 F5 启动 Extension Development Host，Preview 六图渲染正常
- [ ] 切 tab、搜索、导出按钮可用

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "cdn.jsdelivr" src/extension.js && echo CSP_FAIL || echo CSP_OK
  ```

**参考文档**：`src/extension.js`

**活动记录**：
  - 2026-09-04 状态变更 done→todo（暂缓）：随 VS Code 扩展方向一并暂缓；W01-01 离线化已消除 CDN 依赖，重启时只需收紧 CSP

---

### <a id="w02-04"></a>✅ W02-04 · 移除 Python server 依赖路径 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 2h |
| 截止 | 2026-09-11 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | docs / dx |


**背景**：README/DEMO 中 python -m http.server 是旧路径；CLI session report 与 node web 已覆盖，多一条 Python 依赖多一层流失。

**目标**：文档与 demo 脚本统一走 CLI session report / npm run web；python 仅在附录兜底中保留。

**涉及文件**：`README.md` `DEMO.md` `scripts/demo.sh` `USER_GUIDE.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] demo.sh 不依赖 python3
- [ ] README 主路径无 python -m http.server（附录兜底除外并明确标注）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  ! grep -q "python" scripts/demo.sh && echo NOPY_OK
  ```

**参考文档**：`README.md` `DEMO.md`

**活动记录**：
  - 2026-09-04 状态变更 todo→done：校准：demo.sh 无 python，README 主路径无 python -m http.server

---

### <a id="w02-05"></a>✅ W02-05 · 一键预览双路径冒烟清单 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 2h |
| 截止 | 2026-09-11 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | test / release |


**背景**：上架前必须人工确认各路径可用。产品已转向架构验收门，冒烟覆盖 CLI/MCP/网页/setup/文档/架构门六类（扩展段暂缓，标 deferred）。

**目标**：产出可勾选的冒烟清单文档：覆盖 extract/session start/session report/archify-export 等新命令体系，CLI + MCP + 网页离线包各路径有预期结果。

**涉及文件**：`pm/checklists/release-smoke.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 清单覆盖 CLI/MCP/网页/setup/文档/架构门六类路径
- [ ] 每条命令有预期结果描述；MCP 工具数为 6（含 av_archify_export）
- [ ] 含网页 zip 离线检查
- [ ] 扩展段标注「暂缓」，不阻塞发版
- [ ] 实际走查一遍并勾选记录

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/checklists/release-smoke.md && grep -q "session report" pm/checklists/release-smoke.md && grep -q "archify-export" pm/checklists/release-smoke.md && grep -q "6 个工具" pm/checklists/release-smoke.md && echo CHECKLIST_OK
  ```

**参考文档**：—

**活动记录**：
  - 2026-09-04 状态变更 todo→done：校准：release-smoke.md 六类冒烟（扩展段暂缓不阻塞）；MCP 5→6 工具、加 archify 链路

---

### <a id="w02-06"></a>✅ W02-06 · 轻量邮箱账号体系骨架（≤3 文件） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 6h |
| 截止 | 2026-09-11 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | account / pro |


**背景**：License Key/设备码易盗版且体验差；账号体系是 Pro 门禁、Team 转化、埋点的共同底座。先做最小可用：邮箱验证码登录。无框架依赖的 Pro 核心（auth/store/entitlement/crypto）统一下沉在 lib/pro/，CLI / MCP / web 三方复用；web 侧只留 Express 交付层（routes/billing/local 等）。本卡做 CLI/网页端 client 接入（扩展端暂缓）。

**目标**：CLI auth login 命令输入邮箱 → 服务端发码（stub 模式控制台打印）→ 校验 → 本地持久化 token；auth whoami 可查登录态。复用 lib/pro/auth.js 服务端核心，新建 lib/pro/auth-client.js（CLI 可用，本地直调 / 远程 HTTP 双传输）。

**涉及文件**：`lib/pro/auth-client.js` `lib/pro/auth.js` `lib/pro/store.js` `lib/pro/entitlement.js` `lib/pro/crypto.js` `lib/pro/README.md` `web/lib/pro/routes.js` `web/lib/pro/billing.js` `web/lib/pro/local.js` `lib/cli.js` `package.json` `test/auth-client.test.js` `test/pro.test.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] CLI auth login 输入邮箱后 6 位验证码流程可走通（stub 模式码打印在服务端日志）
- [ ] token 持久化在 ~/.config/arch-viewer/auth.json（0600），重启终端仍登录
- [ ] auth whoami 输出当前登录邮箱与 Pro 状态
- [ ] 未登录调用 Pro 命令时 requireUser() 抛 AUTH_REQUIRED 提示登录而非崩溃

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f lib/pro/auth-client.js && test -f lib/pro/auth.js && test -f lib/pro/README.md && echo AUTH_OK
  ```
  ```bash
  node --test test/auth-client.test.js
  ```

**参考文档**：`COMMERCIAL.md`

**活动记录**：
  - 2026-09-04 状态变更 todo→done：CLI 邮箱验证码登录：lib/pro/auth-client.js（本地直调/HTTP 双传输，token 存 ~/.config/arch-viewer/auth.json 0600）；lib/pro/auth.js 加 requestLoginCode/verifyLoginCode/sessionByToken/logoutToken（HMAC 存码、10min、5 次尝试）；web/lib/pro/routes.js 加 /api/pro/auth/* 4 端点（Bearer+cookie）；cli.js 加 auth login/whoami/logout。架构门驱动重构：无框架的 Pro 核心 auth/store/entitlement/crypto 从 web/lib/pro 下沉 lib/pro（web 交付层反向依赖核心，方向合法）；9 个新测试全过，全量 281 测试 0 fail
