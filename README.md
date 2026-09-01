# Architecture Viewer

**卖点不是「一键出图」，是「图脱节就红灯」。**  
Community（Apache-2.0）：CLI / 自托管 Web / Actions 漂移模板免费。  
Viewer 交付六视图；Pro 卖托管漂移评论与增量同步 — 见 [COMMERCIAL.md](COMMERCIAL.md)。

**30 秒看效果** → `npm run web` → http://127.0.0.1:3847/samples/showcase/  
**故意坏图红灯** → http://127.0.0.1:3847/samples/drift-fail/ · [MVP.md](MVP.md) · [README.en.md](README.en.md)

## 1. 主卖点：PR 漂移红灯（Community）

把模板丢进你的仓库，合并前自动拦坏图：

```bash
# 在你的业务仓库里
npx arch-viewer init .
npx arch-viewer generate .
git add architecture_viewer && git commit -m "chore: architecture viewer kit"

mkdir -p .github/workflows
curl -fsSL https://gitee.com/heyangyan/architecture_viewer/raw/master/templates/architecture-check.yml \
  -o .github/workflows/architecture-check.yml
git add .github/workflows/architecture-check.yml && git commit -m "ci: architecture drift gate"
```

本地复现：

```bash
npx arch-viewer check architecture_viewer --filled --drift --repo .
# 坏图 / 占位未清 / Rel 未声明 → exit ≠ 0
```

夹具：`eval/demo-drift`（CI 必须失败）。Pro 再在此之上做 **PR 评论 + 增量同步**（¥29/月）。

## 2. 网页版（分享 / 评审）

```bash
npm run web
# http://127.0.0.1:3847 — 粘贴 Gitee/GitHub URL → /p/<id>
# quality=fast 骨架；quality=refine 精修（需 DeepSeek Key）
```

| API | 作用 |
|-----|------|
| `GET /api/health` | `llmAvailable` 等 |
| `POST /api/generate` | `{ url, quality: "fast"\|"refine", apiKey? }` |
| `GET /p/<id>` | 内联图源分享页 |

## 3. CLI（写进仓库）

```bash
npm i -g architecture-viewer   # 或: node lib/cli.js …
arch-viewer init ./your-repo
arch-viewer generate ./your-repo              # 骨架（默认）
arch-viewer generate ./your-repo --refine     # 精修（需 DEEPSEEK_API_KEY）
arch-viewer check ./your-repo/architecture_viewer --filled --drift --repo ./your-repo
```

扩展命令（F5）：Init / Generate / Preview / Validate。与 CLI 共用 `lib/`。

**分层图通解**：[docs/LAYERED-STYLE.md](docs/LAYERED-STYLE.md)  
**开源仓实战**：[docs/OSS-TUTORIAL.md](docs/OSS-TUTORIAL.md)

---

## 无扩展时：复制文件夹接入

1. 复制套件到目标项目（例如 `docs/architecture/`）
2. 打开 `architecture.config.js`，修改顶部的 **`USER_CONFIG`**
3. Generate 或按 [AGENT.md](AGENT.md) 覆写 6 个 `.md`。独立打开时需 HTTP：

```bash
cd architecture_viewer
python -m http.server 8080
```

> `file://` 会拦截对 `.md` 的 `fetch`。扩展 Preview 已用内联源绕过。

---

## 目录

```
├── lib/                              # 生成 / 校验 / 扫描（CLI · 扩展 · Web）
├── web/                              # 落地页 + API + /p/<id>
├── templates/architecture-check.yml  # 客户可复制的漂移 CI 模板
├── src/extension.js
├── architecture_visualized.html
├── AGENT.md / COMMERCIAL.md / LICENSE
└── eval/demo-drift                   # 坏图夹具（CI 必须失败）
```

---

## 定价摘要

| 档位 | 价格 | 要点 |
|------|------|------|
| Community | ¥0 | 出图 + **自托管漂移 Actions** |
| Pro | ¥29/月 | 托管 PR 漂移评论 + 增量同步 |
| Team | ¥999/年/仓 | 组织规范 + 门禁托管 |

详见 [COMMERCIAL.md](COMMERCIAL.md)。
