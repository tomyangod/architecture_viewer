# Architecture Viewer

**See architecture lights in chat after AI writes code. Green → commit (that accepts the structure).**

Install once → state the request → read the verdict in chat → `git commit`.
CLI / MCP / Web / PR comment, four surfaces.
Free and open source (Apache-2.0), zero-config, seconds to diagram, no LLM dependency.

![demo](docs/demos/demo.gif)

> **中文**: [README.md](README.md)

> **Pain point**: AI coding sessions touch dozens of files — and before merge, nobody can
> say exactly what changed in the architecture. Which widely-depended-on type got deleted?
> Any cross-layer calls? New third-party deps? Who's downstream and affected?
> Architecture Viewer gives you a Before/After diff and risk grading at session end.

---

## Four Ways to Use

### 1. One-Click Setup for AI Tools (recommended · Cursor / Claude / DeepSeek)

```bash
npx arch-viewer setup              # user-level MCP
npx arch-viewer setup . --project  # project hooks + cross-host rules (gate on stop)
npx arch-viewer uninstall .        # remove this repo's integration (other MCP untouched)
# also remove global package: add --npm
# also wipe session reports/snapshots (keeps .av/layers.json): add --purge
```

Detects installed AI coding tools (Cursor, Claude, DeepSeek Harness) and writes MCP config.
Then tell your AI: "check architecture before you claim you're done." It should call `av_guard`
and paste the ≤3-line **verdict**. With git, the baseline is **HEAD** — **commit = accept**.
No snapshot ritual, no default HTML. Upgrade: `uninstall` (plus `--npm` if needed), then setup again.

### 2. CLI Session Gate (scripts / CI / no MCP)

```bash
npx arch-viewer session report     # vs git HEAD (snapshot fallback when no git)
npx arch-viewer session guard --adapter generic
```

Daily use does not need `session start`. No-git repos: `av_guard` / `session guard` auto-ensure a snapshot.
HTML (`.av/session-report.html`) is optional deep-dive.
Exit code 1 on high risk. `session report` / `check` / `diff` share: `0` pass · `1` architecture gate failed · `2` bad args/config · `3` scan/parse failed · `4` missing or invalid baseline. See [Quickstart §6.3](docs/guides/quickstart.md).

The old start → open HTML → start again loop is in the [Quickstart appendix](docs/guides/quickstart.md#附录a-拍照仪式高级).

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

Install once, then just talk:

```bash
npx arch-viewer setup
# enforce on stop: npx arch-viewer setup . --project
```

Tell the AI: "run the architecture gate when you're done." Treat the chat **verdict** as acceptance:
green → `git commit`; red → fix or explain (`av_explain_finding`).

Without MCP:

```bash
npx arch-viewer session report .       # vs HEAD; add --open only if you want the diagram
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
| Team | ¥99/person/mo (early-adopter, application only) | Org rules + hosted CI gate |

See [COMMERCIAL.md](docs/commercial/COMMERCIAL.md).
