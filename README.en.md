# Architecture Viewer

**See what changed in your architecture after AI writes code.**

Session baseline → change graph → impact analysis: CLI / MCP / Web / PR comment, four surfaces.
Free and open source (Apache-2.0), zero-config, seconds to diagram, no LLM dependency.

![demo](docs/demo.gif)

> **中文**: [README.md](README.md)

> **Pain point**: AI coding sessions touch dozens of files — and before merge, nobody can
> say exactly what changed in the architecture. Which widely-depended-on type got deleted?
> Any cross-layer calls? New third-party deps? Who's downstream and affected?
> Architecture Viewer gives you a Before/After diff and risk grading at session end.

---

## Four Ways to Use

### 1. CLI Session Gate (AI coding session wrap-up)

```bash
npx arch-viewer session start        # 1. Before AI writes code: record architecture baseline
# ...AI writes code / you write code...
npx arch-viewer session report       # 2. Session end: Before/After diff + risk grading
npx arch-viewer session start        # 3. Confirm changes look right: refresh baseline
```

Output: entity added/removed/modified/renamed counts, external dependency changes, risk findings
(red cross-layer violations / type deletions / layer penetration / new external deps),
**reverse dependency impact** (who's affected), plus a shareable HTML Before/After diagram.
Exit code 1 on high risk — wire it into your AI coding workflow (see `.trae/rules/`).

### 2. One-Click Setup for AI Tools (Cursor / Claude / DeepSeek)

```bash
npx arch-viewer setup          # Auto-installs, opens visual guide, then just talk to your AI
```

Auto-detects installed AI coding tools (Cursor, Claude, DeepSeek Harness) and writes architecture
check rules into their config directories. Then tell your AI "take a snapshot before coding,
check for breakage after."

### 3. PR Auto-Comment (GitHub Actions)

Each PR gets an architecture impact comment; repeated pushes update the same comment, no spam:

```yaml
# .github/workflows/architecture-diff.yml
name: Architecture Diff
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  impact-comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Checkout PR base
        run: git worktree add --detach /tmp/av-base "${{ github.event.pull_request.base.sha }}"
      - name: Post architecture impact comment
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx --yes arch-viewer@latest pr-comment /tmp/av-base . --post
```

Team diagram rules (`architecture-rules.example.yaml`) and a drift + rules PR comment workflow live in `.github/workflows/architecture-drift.yml` (Gitee twin under `.gitee/workflows/`). Run `npx arch-viewer check . --rules architecture-rules.example.yaml`.

### 4. Web (Share / Review)

```bash
npm run web    # http://127.0.0.1:3847 — paste repo URL to generate six-view diagram, /p/<id> inline share
```

---

## Install

```bash
npm i -g arch-viewer        # CLI global install
# or use without installing: npx arch-viewer <command>
```

Requires Node.js >= 18. Supported languages: JavaScript / TypeScript (incl. Vue, Svelte), Python, Go, Java
(tree-sitter parsing, prebuilt binaries for six platforms, no compilation needed).

## Quick Start (30 seconds)

```bash
npx arch-viewer session start .        # 1. Before coding: snapshot the "before" structure
echo '// change some code: add/remove a class or change an import'
npx arch-viewer session report .       # 2. After: diff before/after, see if anything broke (--open for browser)
```

Other commands:

```bash
arch-viewer extract <repo> --out graph.json      # Export code structure graph
arch-viewer diff <base-dir> <head-dir> --json    # Structure diff (JSON)
arch-viewer impact <base-dir> <head-dir>         # Impact text report
arch-viewer pr-comment <base-dir> <head-dir>     # PR comment Markdown (--post to send)
arch-viewer workspace ...                         # Multi-repo baseline management
arch-viewer auth login [email]                    # Email verification code login (Pro account)
arch-viewer auth whoami                           # Check current login email and Pro status
```

---

## Pro Account

```bash
arch-viewer auth login you@example.com    # Enter email, receive 6-digit code, verify
arch-viewer auth whoami                  # Check current login email and Pro status
arch-viewer auth logout                  # Log out
```

First login auto-creates a 7-day Pro trial account. Token stored in `~/.config/arch-viewer/auth.json` (0600),
survives terminal restart. See [lib/pro/README.md](lib/pro/README.md).

## Privacy & Telemetry

CLI telemetry is **off by default**, enterprise-friendly. Enable:

```bash
export ARCH_TELEMETRY=1    # Enable
# or set DO_NOT_TRACK=1 to permanently disable (highest priority)
```

When enabled, only records: event name (CLI command), duration (ms), exit code, CLI version, OS type.
**Never records**: file paths, code content, repo name/URL, user email. Data stored locally at
`~/.config/arch-viewer/telemetry.log` (JSONL), viewable and deletable at any time.

---

## Directory

```
lib/                              # Scan / diff / impact / risk rules / report / telemetry (CLI . MCP . Web)
├── pro/                          # Pro core: account / entitlement / store / CLI auth client
├── src/extension*.js             # VS Code extension (deferred)
├── scripts/pr-comment.js         # CI comment entry point (architecture diff)
├── scripts/ci-drift-action.mjs   # CI: drift / rules check + PR comment
├── architecture-rules.example.yaml
├── web/                          # Landing page + API + /p/<id> share + Pro routes
├── .github/workflows/            # check gate + diff comment + drift/rules comment
├── .gitee/workflows/             # Gitee twin of the drift pipeline
├── templates/                    # Copyable kits and CI templates
└── eval/                         # Multi-language parse fixtures and benchmarks
```

## Pricing

| Tier | Price | Highlights |
|------|-------|------------|
| Community | Free | CLI session gate + self-hosted Actions (drift gate + PR comment) |
| Pro | ¥29/mo | Hosted PR comments + incremental sync + email account |
| Team | ¥999/yr/repo | Org rules + hosted CI gate |

See [COMMERCIAL.md](COMMERCIAL.md).
