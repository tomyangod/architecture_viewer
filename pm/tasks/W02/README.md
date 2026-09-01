# W02 任务卡 · 打包脚手架 / Webview 回归 / 账号骨架

> 阶段：Phase 0 ｜ 周期：2026-09-07 ~ 2026-09-11 ｜ 周截止：2026-09-11
>
> 完成度：0/6 ░░░░░░░░░░ 0%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w02-01"></a>⬜ W02-01 · VS Code 扩展打包脚手架（vsce） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 4h |
| 截止 | 2026-09-11 |
| 依赖 | [W01-01](../W01/README.md#w01-01)、[W01-02](../W01/README.md#w01-02) |
| 负责人 | heyangyan |
| 标签 | infra / release |


**背景**：package.json 已有 publisher/commands，但缺 icon、repository 完整字段、vsce 打包验证；.vscodeignore 需确保不把 eval/、web/ 多余文件打进去。

**目标**：一条命令打出可侧载的 .vsix，内容最小且完整（含 vendor/mermaid、NOTICE、LICENSE）。

**涉及文件**：`package.json` `.vscodeignore` `scripts/package-vsix.sh` `assets/icon.png`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] npx @vscode/vsce package 成功产出 architecture-viewer-*.vsix
- [ ] vsix 内包含 vendor/mermaid.min.js、NOTICE、LICENSE，不含 eval/out、node_modules 测试件
- [ ] package.json 含 icon、repository、engines、categories、keywords

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  npx @vscode/vsce package --no-dependencies -o /tmp/av-test.vsix && unzip -l /tmp/av-test.vsix | grep -q "vendor/mermaid" && echo VSIX_OK
  ```

**参考文档**：`package.json` `.vscodeignore`

**活动记录**：
  - （暂无）

---

### <a id="w02-02"></a>⬜ W02-02 · 网页版可下载离线包 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 4h |
| 截止 | 2026-09-11 |
| 依赖 | [W01-01](../W01/README.md#w01-01) |
| 负责人 | heyangyan |
| 标签 | web / release |


**背景**：无 IDE 的评审者需要零门槛打开；下载离线包也是未来私有化交付的雏形。

**目标**：构建脚本把网页版静态产物（含内联 mermaid）打成 zip，解压后 node server.js 或直接打开即可用。

**涉及文件**：`scripts/build-web-dist.mjs` `web/server.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] node scripts/build-web-dist.mjs 产出 dist/architecture-viewer-web.zip
- [ ] 解压到空目录后 node server.js 可启动并生成六视图
- [ ] zip 内无 CDN 引用

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  node scripts/build-web-dist.mjs && test -f dist/architecture-viewer-web.zip && echo WEBZIP_OK
  ```

**参考文档**：`web/server.js`

**活动记录**：
  - （暂无）

---

### <a id="w02-03"></a>⬜ W02-03 · Webview 离线回归与 CSP 加固 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 3h |
| 截止 | 2026-09-11 |
| 依赖 | [W01-01](../W01/README.md#w01-01) |
| 负责人 | heyangyan |
| 标签 | extension / security |


**背景**：buildPreviewHtml 的 CSP 当前放行 cdn.jsdelivr.net；离线化后应收紧为 localResourceRoots + cspSource，消除远程 connect-src。

**目标**：Webview CSP 无远程域名；F5 开发宿主与侧载 vsix 两条路径断网均可 Preview。

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
  - （暂无）

---

### <a id="w02-04"></a>⬜ W02-04 · 移除 Python server 依赖路径 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 2h |
| 截止 | 2026-09-11 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | docs / dx |


**背景**：README/DEMO 中 python -m http.server 是旧路径；扩展 Preview 与 node web 已覆盖，多一条 Python 依赖多一层流失。

**目标**：文档与 demo 脚本统一走扩展 Preview / npm run web；python 仅在「无扩展兜底」附录中保留。

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
  - （暂无）

---

### <a id="w02-05"></a>⬜ W02-05 · 一键预览双路径冒烟清单 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 2h |
| 截止 | 2026-09-11 |
| 依赖 | [W02-01](../W02/README.md#w02-01)、[W02-03](../W02/README.md#w02-03) |
| 负责人 | heyangyan |
| 标签 | test / release |


**背景**：上架前必须人工确认两条安装路径都可用，否则首批用户差评致命。

**目标**：产出可勾选的冒烟清单文档：F5 开发宿主 + vsix 侧载，各跑 Init/Generate/Preview/Validate/Copy Prompt。

**涉及文件**：`pm/checklists/release-smoke.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 清单覆盖两条路径 × 五条命令
- [ ] 每条命令有预期结果描述
- [ ] 实际走查一遍并勾选记录

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f pm/checklists/release-smoke.md && grep -q "Init" pm/checklists/release-smoke.md && grep -q "Validate" pm/checklists/release-smoke.md && echo CHECKLIST_OK
  ```

**参考文档**：—

**活动记录**：
  - （暂无）

---

### <a id="w02-06"></a>⬜ W02-06 · 轻量邮箱账号体系骨架（≤3 文件） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 未开始（进度 0%） |
| 工时预估 | 6h |
| 截止 | 2026-09-11 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | account / pro |


**背景**：License Key/设备码易盗版且体验差；账号体系是 Pro 门禁、Team 转化、埋点的共同底座。先做最小可用：邮箱验证码登录。

**目标**：扩展内 Login 命令输入邮箱 → 服务端发码（开发期控制台打印/邮件 stub）→ 校验 → 本地持久化 token；whoami 可查登录态。

**涉及文件**：`account/auth-client.js` `web/lib/auth.js` `account/README.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 命令面板有 Architecture Viewer: Login / Logout / Who Am I
- [ ] 输入邮箱后 6 位验证码流程可走通（stub 模式码打印在服务端日志）
- [ ] token 持久化在 globalState，重启编辑器仍登录
- [ ] 未登录调用 Pro 命令时提示登录而非崩溃

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f account/auth-client.js && test -f web/lib/auth.js && test -f account/README.md && echo AUTH_OK
  ```

**参考文档**：`COMMERCIAL.md`

**活动记录**：
  - （暂无）
