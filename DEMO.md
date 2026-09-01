# 60 秒演示：Init → Generate → Preview → CI fail（+ 网页分享）

产品形态是 **Cursor / VS Code 扩展** + **网页版**。Viewer HTML 是生成结果，不是产品本体。

## 命令面板（扩展）

1. **Architecture Viewer: Init Kit** — 把套件拷进当前仓库  
2. **Architecture Viewer: Generate** — 扫描仓库，写出 6 个 `.md`，并做 Rel 校验  
3. **Architecture Viewer: Preview** — Webview 打开图（无需 `python -m http.server`）  
4. **Architecture Viewer: Validate** — 协议 + 漂移；不过则视为 CI 红灯  

精修（可选）：**Copy Cursor Agent Prompt**，粘贴到 Chat，按 `AGENT.md` 覆写图源。

## 网页版（分享页）

```bash
npm run web
# http://127.0.0.1:3847  → 选样例 → 生成 → 打开 /p/<id>
```

适合给非开发者一个链接；扩展适合把图源提交进 Git。

## CLI（与扩展 / Web 同一套 lib）

```bash
node lib/cli.js init
node lib/cli.js generate
node lib/cli.js check . --filled --drift
bash scripts/demo.sh
```

`scripts/demo.sh` 会：搭一个临时小仓 → Init → Generate → 对 `eval/demo-drift` 跑 check（**必须失败**：未声明 `Rel` + 未填模板）。这就是「CI fail」路径。

GitHub Actions：`.github/workflows/ci.yml` 锁定同一条链路。

## 本地 F5

打开本仓库，按 F5 启动「Extension Development Host」，在新窗口打开任意项目，再跑上面 4 条命令。
