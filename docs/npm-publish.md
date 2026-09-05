# 发布 arch-viewer 到 npm（0.11.0）

registry 当前 `latest` 仍是 **0.3.1**（2026-09-01）。本地 `package.json` 已是 **0.11.0**。本机未登录 npm 时不能代发。

## 一次发布

```bash
# 1. 登录（交互；或设 NPM_TOKEN）
npm login
# 或：export NPM_TOKEN=npm_…   且 ~/.npmrc 含 //registry.npmjs.org/:_authToken=${NPM_TOKEN}

# 2. 看将打进包的文件（不应含 docs/demo.mp4、archify-main、.data）
npm pack --dry-run

# 3. 发布（prepublishOnly 会跑语法检查 + 全量测试）
npm publish --access public
# 或：npm run release:npm

# 4. 核验
npm view arch-viewer version
npx -y arch-viewer@0.11.0 --help
```

包名：`arch-viewer`（unscoped）。二进制：`arch-viewer`、`arch-viewer-mcp`。

## 白名单（`package.json` `files`）

必须含 `mcp/`（setup / `arch-viewer-mcp`）、套件图源 6 个 `.md`、`templates/`、`docs/welcome.html`。不要把 `eval/`、`pm/`、`docs/demo.mp4`、`.data/` 打进去。

## 发布后

把版本与日期记进 [pm/metrics.md](../pm/metrics.md) 备注。首笔 Pro 到账仍走 [billing.md](billing.md)，记订单号后才能结 W09-03。
