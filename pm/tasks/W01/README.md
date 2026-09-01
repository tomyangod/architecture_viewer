# W01 任务卡 · 离线化 / 合规 / 商业文档

> 阶段：Phase 0 ｜ 周期：2026-08-31 ~ 2026-09-04 ｜ 周截止：2026-09-04
>
> 完成度：6/6 ██████████ 100%

> 本文件由 `node pm/scripts/wbs-cards.mjs` 自动生成，请勿手改；状态请改 `pm/tasks/tasks.json` 或用 `node pm/scripts/wbs.mjs set <任务号> <状态>`。


### <a id="w01-01"></a>✅ W01-01 · 离线打包 Mermaid，移除 CDN 硬依赖 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 5h |
| 截止 | 2026-09-04 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | infra / offline |


**背景**：现状：src/extension.js 的 CSP 白名单含 cdn.jsdelivr.net，architecture_visualized.html 与 web 页面从 CDN 加载 Mermaid。企业内网不可用，且 Marketplace 审核偏好无远程依赖。

**目标**：Mermaid 运行时全部本地化，断网可渲染六视图。

**涉及文件**：`vendor/mermaid.min.js` `src/extension.js` `architecture_visualized.html` `architecture.config.js` `web/public/index.html` `lib/kit.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] 仓库源码中不存在 cdn.jsdelivr.net / unpkg 等远程脚本引用
- [ ] 断网（关闭 Wi-Fi）后扩展 Preview 六视图全部渲染、无 console 报错
- [ ] 网页版 npm run web 断网同样可渲染
- [ ] npm test 通过

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -rn "cdn.jsdelivr\|unpkg" src/ web/ lib/ architecture_visualized.html architecture.config.js || echo OFFLINE_OK
  ```
  ```bash
  npm test
  ```

**参考文档**：`src/extension.js` `COMMERCIAL.md`

**活动记录**：
  - 2026-08-29 状态变更 todo→done

---

### <a id="w01-02"></a>✅ W01-02 · NOTICE 第三方署名文件 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 1h |
| 截止 | 2026-09-04 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | legal |


**背景**：Apache-2.0 要求再分发时保留 NOTICE 与第三方署名；Mermaid 为 MIT 许可，需要在分发物中署名。

**目标**：根目录新增 NOTICE，列清 Mermaid(MIT) 等第三方依赖与本项目 Apache-2.0 声明。

**涉及文件**：`NOTICE`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] NOTICE 存在，包含 Architecture Viewer Apache-2.0 声明
- [ ] NOTICE 列出 Mermaid (MIT) 及版本号
- [ ] vsix 打包物中包含 NOTICE 与 LICENSE

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f NOTICE && grep -q "Mermaid" NOTICE && grep -q "Apache" NOTICE && echo NOTICE_OK
  ```

**参考文档**：`LICENSE` `COMMERCIAL.md`

**活动记录**：
  - 2026-08-29 状态变更 todo→done

---

### <a id="w01-03"></a>✅ W01-03 · CHANGELOG 规范化（Keep a Changelog） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 1h |
| 截止 | 2026-09-04 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | docs |


**背景**：现有 CHANGELOG 只有 0.1.0 一段；Marketplace 与用户都期待可见的版本演进。

**目标**：按 Keep a Changelog 格式增加 [Unreleased] 段，后续每周改动归集 Added/Changed/Fixed。

**涉及文件**：`CHANGELOG.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] CHANGELOG 含 [Unreleased] 与 [0.1.0] 两段
- [ ] 格式符合 Keep a Changelog（Added/Changed/Fixed 分组）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "Unreleased" CHANGELOG.md && grep -q "0.1.0" CHANGELOG.md && echo CHANGELOG_OK
  ```

**参考文档**：`CHANGELOG.md`

**活动记录**：
  - 2026-08-29 状态变更 todo→done

---

### <a id="w01-04"></a>✅ W01-04 · Playwright 端到端冒烟测试 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 6h |
| 截止 | 2026-09-04 |
| 依赖 | [W01-01](../W01/README.md#w01-01) |
| 负责人 | heyangyan |
| 标签 | test / ci |


**背景**：现有 test/ 只有单测；六视图渲染错误（mermaid 语法错、tab 切换失败）只能靠肉眼。需要可重复的自动冒烟。

**目标**：Playwright 冒烟：网页版六视图 tab 逐个切换无渲染错误、/p/<id> 分享页可打开、离线 bundle 可加载。

**涉及文件**：`test/e2e/smoke.spec.js` `playwright.config.js` `package.json` `.github/workflows/ci.yml`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] npx playwright test 全部通过
- [ ] 用例覆盖：六个 tab 切换、mermaid svg 存在、无 .error-text / 渲染异常
- [ ] CI workflow 中执行 e2e（或记录本地执行方式）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  npx playwright install --with-deps chromium
  ```
  ```bash
  npx playwright test --reporter=line
  ```

**参考文档**：`test/web.test.js` `web/server.js`

**活动记录**：
  - 2026-08-29 状态变更 todo→done

---

### <a id="w01-05"></a>✅ W01-05 · 英文落地页骨架（双语切换） 

| 字段 | 内容 |
|---|---|
| 优先级 | **P1** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 4h |
| 截止 | 2026-09-04 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | growth / i18n |


**背景**：仅中文天花板低；$4 价位对 $15–80 的海外竞品是降维打击，英文 landing 是海外杠杆。调研结论：双语是必选项。

**目标**：README.en.md 与网页落地页支持中/英切换（?lang=en），首屏含价值主张、60 秒 demo、安装按钮。

**涉及文件**：`README.en.md` `web/public/index.html` `web/public/app.js`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] README.en.md 存在且含 Quick Start / Install / Demo 段落
- [ ] 落地页 ?lang=en 展示英文，?lang=zh 展示中文，默认中文
- [ ] 英文页无机器翻译硬伤（关键术语 C4/drift/preview 准确）

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  test -f README.en.md && grep -qi "install" README.en.md && grep -qi "mermaid" README.en.md && echo EN_OK
  ```

**参考文档**：`docs/market-evaluation/market-evaluation.html`

**活动记录**：
  - 2026-08-29 状态变更 todo→done

---

### <a id="w01-06"></a>✅ W01-06 · 商业化文档修订：定价与核心卖点重排 

| 字段 | 内容 |
|---|---|
| 优先级 | **P0** |
| 状态 | 已完成（进度 100%） |
| 工时预估 | 2h |
| 截止 | 2026-09-04 |
| 依赖 | 无 |
| 负责人 | heyangyan |
| 标签 | biz / docs |


**背景**：调研结论：按次计费反人性（micro-SaaS 61% 固定月费）；一次性生成撑不起订阅；¥29/月是国内被验证的首付费墙；团队应按仓库计费。

**目标**：COMMERCIAL.md 改写：Pro=¥29/月无限生成，核心卖点=自动同步+漂移检测+PR 评论；Team=¥999/年/仓库；删除按次/额度表述。

**涉及文件**：`COMMERCIAL.md`

**验收标准**（逐条勾选，全部满足才能标 done）：
- [ ] COMMERCIAL.md 含 Pro ¥29/月、无限生成
- [ ] 含 Team ¥999/年/仓库
- [ ] 核心卖点顺序：防漂移闭环在前，六视图生成在后
- [ ] 不再出现按次计费/生成额度作为付费墙的描述

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
  ```bash
  grep -q "¥29" COMMERCIAL.md && grep -q "999" COMMERCIAL.md && ! grep -q "按次" COMMERCIAL.md && echo BIZ_OK
  ```

**参考文档**：`COMMERCIAL.md` `docs/market-evaluation/market-evaluation.html`

**活动记录**：
  - 2026-08-29 状态变更 todo→done
