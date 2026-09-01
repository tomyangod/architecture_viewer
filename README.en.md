# Architecture Viewer

**The sell is not “generate a diagram once.” It is “fail the PR when diagrams drift.”**  
Community (Apache-2.0): CLI, self-hosted web, and a free Actions drift template.  
Pro adds hosted PR drift comments and incremental sync — see [COMMERCIAL.md](COMMERCIAL.md).

## Quick Start (60 seconds)

```bash
git clone https://gitee.com/heyangyan/architecture_viewer.git
cd architecture_viewer
npm run web
# → http://127.0.0.1:3847/samples/showcase/
# → http://127.0.0.1:3847/samples/drift-fail/   # intentional CI red light
# → http://127.0.0.1:3847/?lang=en
```

## Drift gate on your repo (Community)

```bash
npx arch-viewer init .
npx arch-viewer generate .
mkdir -p .github/workflows
curl -fsSL https://gitee.com/heyangyan/architecture_viewer/raw/master/templates/architecture-check.yml \
  -o .github/workflows/architecture-check.yml
```

Local check:

```bash
npx arch-viewer check architecture_viewer --filled --drift --repo .
# demo fixture that must fail:
node lib/cli.js check eval/demo-drift --filled
```

## CLI refine (optional)

```bash
export DEEPSEEK_API_KEY=sk-...
arch-viewer generate ./your-repo --refine
arch-viewer check ./your-repo/architecture_viewer --filled --drift --repo ./your-repo
```

## Pricing sketch

| Tier | Price | Includes |
|------|-------|----------|
| Community | Free | Extension, CLI, self-hosted web, **Actions drift template** |
| Pro | ¥29 / month | Unlimited cloud generate, incremental sync, **hosted PR drift comments** |
| Team | ¥999 / year / repo | Shared library, org rules, hosted CI gate |

Mermaid is vendored offline (`vendor/mermaid.min.js`). See [NOTICE](NOTICE).

Chinese README: [README.md](README.md). MVP walkthrough: [MVP.md](MVP.md).
