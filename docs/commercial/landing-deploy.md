# 落地页部署

产品落地页即 `web/public/index.html`（定价 / 60 秒 demo / 安装）。完整能力（粘贴 URL 出图、账号、收款）走 Node Web。

## 本地 / 自托管（推荐，公网可用）

```bash
# 默认只绑 127.0.0.1
npm run web
# 打开 http://127.0.0.1:3847/

# 公网或局域网：绑 0.0.0.0，前面再挂 Nginx / Caddy
HOST=0.0.0.0 PORT=3847 npm run web
```

Docker：

```bash
docker compose up -d
# 打开 http://<host>:3847/
```

Demo 视频由 Web 服务从 `docs/demos/demo.mp4` 映射到 `/demo.mp4`（含中英 VTT）。无需再拷一份进 `web/public/`。

## 静态镜像（GitHub / Gitee Pages）

静态站只有营销页（视频、定价、安装命令），**没有** `/api/generate`。

```bash
node scripts/prepare-landing-static.mjs
# 产物：dist/landing/（含 index.html、样式、demo.mp4）
```

GitHub Actions：`.github/workflows/landing-pages.yml` 在 `main` 推送后构建并发布到 `gh-pages`。静态包会把 `/styles.css` 等改成相对路径，因此 `https://<user>.github.io/<repo>/` 项目页也能加载样式和 demo 视频。`/api/*` 在静态站不可用，完整产品仍走 `npm run web`。

| 环境 | URL |
|---|---|
| 本机 | http://127.0.0.1:3847/ |
| 自托管（填实际上线域名） | 见下表「当前公网」 |
| GitHub Pages（开启后） | https://heyangyan.github.io/architecture_viewer/ |
| Gitee Pages（开启后） | https://heyangyan.gitee.io/architecture_viewer/ |

**当前公网**：以自托管 `npm run web` / `docker compose` 为准。Pages 需在仓库 Settings 打开 Pages 并指向 `gh-pages`（或 Gitee 对应分支）后回填上表。仓库首页仍是 [Gitee](https://gitee.com/heyangyan/architecture_viewer)。
