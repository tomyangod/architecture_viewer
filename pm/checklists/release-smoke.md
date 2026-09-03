# 发布冒烟清单

> 每次发版前逐条跑一遍。全绿才能发。

## CLI 冒烟

- [ ] `node lib/cli.js extract .` 正常输出 fingerprint + 节点/边统计
- [ ] `node lib/cli.js session start .` 输出 baseline recorded + fingerprint
- [ ] `node lib/cli.js session report .` 输出变更报告（零变更场景显示 NONE）
- [ ] `npm test` 全绿（0 fail）

## MCP 冒烟

- [ ] `node mcp/server.js` 能启动，stdin 读取不崩
- [ ] tools/list 返回 5 个工具（av_session_start / av_session_changes / av_session_report / av_check_layering / av_explain_finding）
- [ ] av_session_start 对临时仓返回 baseline JSON
- [ ] av_session_report 对同一临时仓返回变更报告

## 扩展冒烟

- [ ] `node scripts/build-vsix.js` 成功产出 .vsix
- [ ] .vsix 解压后含 `src/`、`assets/`、`lib/`、`package.json`
- [ ] VS Code 安装 .vsix 后命令面板可见 `AV: Session Start` 等命令
- [ ] 状态栏角标正常显示

## 网页冒烟

- [ ] `npm run web` 启动后 http://127.0.0.1:3847 可访问
- [ ] 首页正常渲染（系统字体 fallback，无 CDN 依赖）
- [ ] `node scripts/build-web-dist.mjs` 成功产出 zip
- [ ] 解压 zip → `node server.js` → 浏览器可访问（离线可用）

## setup 冒烟

- [ ] `node lib/cli.js setup` 在无 AI 工具的机器上优雅退出（提示未检测到）
- [ ] 有 Cursor 的机器上运行后 `~/.cursor/mcp.json` 含 arch-viewer 段
- [ ] 重复运行不重复注册（幂等）
- [ ] 运行前自动备份原配置（.bak）

## 文档冒烟

- [ ] CHANGELOG 最新版本号与 package.json 一致
- [ ] README Quick Start 步骤可复现
- [ ] docs/welcome.html 浏览器打开正常渲染
- [ ] docs/SESSION-GUIDE.md 无死链

## 架构门

- [ ] `npm run arch:report` 退出码 0
- [ ] Risk level NONE 或已逐条处置 HIGH findings
- [ ] 基线已刷新（`npm run arch:baseline`）
