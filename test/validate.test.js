const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkFile, validateDir } = require('../lib/validate');
const { generateFiles } = require('../lib/generate');
const { scan, checkDrift } = require('../lib/scan');
const { generateToDir, checkKit } = require('../lib');

describe('validate Rel declarations', () => {
  it('flags undeclared Rel endpoints', () => {
    const md = `## 子图1：x

\`\`\`mermaid
C4Container
    Person(user, "u")
    Rel(user, ghost, "nope")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`
`;
    const r = checkFile('c4-container.md', md, {});
    assert.ok(r.errors.some((e) => /NOT DECLARED/.test(e)));
  });

  it('accepts declared Rel', () => {
    const md = `## 子图1：x

\`\`\`mermaid
C4Container
    Person(user, "u")
    Container(web, "web", "n", "")
    Rel(user, web, "ok")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`

`;
    const r = checkFile('c4-container.md', md, {});
    assert.deepEqual(r.errors, []);
  });

  it('accepts _Ext/Db/Queue C4 declarations (mermaid-legal)', () => {
    const md = `## 子图1：x

\`\`\`mermaid
C4Component
    System_Ext(saas, "saas")
    Container_Ext(xinference, "Xinference", "模型服务")
    Component_Ext(extcomp, "外部组件", "n")
    SystemDb(db, "DB")
    ContainerQueue(q, "Q")
    Component(sdk, "sdk", "Python")
    Rel(sdk, xinference, "调用", "HTTP")
    Rel(sdk, extcomp, "relay")
    Rel(sdk, db, "读写")
    Rel(sdk, q, "publish")
    Rel(sdk, saas, "sync")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`
`;
    const r = checkFile('c4-component.md', md, {});
    assert.deepEqual(r.errors, []);
  });

  it('flowchart C4 does NOT warn missing UpdateLayoutConfig', () => {
    const md = `## 子图1：x

\`\`\`mermaid
flowchart TB
    subgraph APP["🧩 应用"]
        A["🐍 入口<br/><small>app/main.py</small>"]
    end
    A -->|调用| B["📦 模型"]
\`\`\`
`;
    const r = checkFile('c4-container.md', md, {});
    assert.ok(!r.warnings.some((w) => /UpdateLayoutConfig/.test(w)),
      'flowchart C4 should not require UpdateLayoutConfig');
  });

  it('native C4Context without UpdateLayoutConfig DOES warn', () => {
    const md = `## 子图1：x

\`\`\`mermaid
C4Context
    Person(user, "u")
    System(sys, "s")
    Rel(user, sys, "ok")
\`\`\`
`;
    const r = checkFile('c4-context.md', md, {});
    assert.ok(r.warnings.some((w) => /missing UpdateLayoutConfig/.test(w)),
      'native C4Context still requires UpdateLayoutConfig');
  });

  it('native C4Container with UpdateLayoutConfig does NOT warn', () => {
    const md = `## 子图1：x

\`\`\`mermaid
C4Container
    Person(user, "u")
    Container(web, "web", "n", "")
    Rel(user, web, "ok")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`
`;
    const r = checkFile('c4-container.md', md, {});
    assert.ok(!r.warnings.some((w) => /UpdateLayoutConfig/.test(w)));
  });

  it('native C4Component without UpdateLayoutConfig DOES warn', () => {
    const md = `## 子图1：x

\`\`\`mermaid
C4Component
    Component(a, "a", "py", "")
    Component(b, "b", "py", "")
    Rel(a, b, "ok")
\`\`\`
`;
    const r = checkFile('c4-component.md', md, {});
    assert.ok(r.warnings.some((w) => /missing UpdateLayoutConfig/.test(w)));
  });

  it('native C4Context WITH UpdateLayoutConfig does NOT warn', () => {
    const md = `## 子图1：x

\`\`\`mermaid
C4Context
    Person(user, "u")
    System(sys, "s")
    Rel(user, sys, "ok")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`
`;
    const r = checkFile('c4-context.md', md, {});
    assert.ok(!r.warnings.some((w) => /UpdateLayoutConfig/.test(w)));
  });

  it('per-block: mixed native C4 (no ULC) + flowchart blocks warn once', () => {
    const md = `## 子图1：原生

\`\`\`mermaid
C4Context
    Person(user, "u")
    System(sys, "s")
    Rel(user, sys, "ok")
\`\`\`

## 子图2：flowchart

\`\`\`mermaid
flowchart LR
    A["🧩 系统"] --> B["🗄️ 库"]
\`\`\`
`;
    const r = checkFile('c4-context.md', md, {});
    const ulc = r.warnings.filter((w) => /missing UpdateLayoutConfig/.test(w));
    assert.equal(ulc.length, 1, 'only the native block warns');
    assert.match(ulc[0], /sub-1/);
  });

  it('non-c4 files never warn UpdateLayoutConfig (isC4 gate)', () => {
    const md = `## 子图1：x

\`\`\`mermaid
flowchart TB
    A["🐍 入口"] --> B["🔌 路由"]
\`\`\`
`;
    for (const f of ['deployment-ops.md', 'block-diagram.md']) {
      const r = checkFile(f, md, {});
      assert.ok(!r.warnings.some((w) => /UpdateLayoutConfig/.test(w)), f);
    }
  });

  it('fails demo-drift fixture', () => {
    const dir = path.join(__dirname, '..', 'eval', 'demo-drift');
    const r = validateDir(dir, { requireFilled: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /NOT DECLARED/.test(e)));
    assert.ok(r.errors.some((e) => /placeholder/.test(e)));
  });
});

describe('generate + check', () => {
  it('produces valid diagrams for a tiny repo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-viewer-'));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Demo App\n');
    fs.mkdirSync(path.join(tmp, 'backend'));
    fs.writeFileSync(path.join(tmp, 'backend', 'main.py'), 'class Worker:\n    pass\n');
    fs.writeFileSync(path.join(tmp, 'index.html'), '<html></html>');
    const kit = path.join(tmp, 'kit');
    const result = generateToDir(tmp, kit);
    assert.equal(result.protocol.ok, true, result.protocol.errors.join('\n'));
    assert.equal(result.drift.ok, true, JSON.stringify(result.drift.missing));
    const checked = checkKit(kit, { requireFilled: true, drift: true, repo: tmp });
    assert.equal(checked.ok, true);
  });

  it('scan reads compose services', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-scan-'));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Compose App\n');
    fs.writeFileSync(
      path.join(tmp, 'docker-compose.yml'),
      'services:\n  api:\n    image: x\n  worker:\n    image: y\n'
    );
    const inv = scan(tmp);
    assert.ok(inv.services.some((s) => s.id === 'api'));
    const files = generateFiles(inv);
    assert.match(files['c4-container.md'], /Container\(api/);
  });

  it('scan ignores shell comments in README code blocks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-title-'));
    fs.writeFileSync(
      path.join(tmp, 'README.md'),
      'Some intro text.\n\n```shell\n# Download the compose file to the current directory.\ncurl -LO https://example.com/docker-compose.yml\n```\n'
    );
    const inv = scan(tmp);
    // Title should fall back to dir name, NOT pick up the shell comment
    assert.equal(inv.title, path.basename(tmp));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('scan extracts go.mod module name as title', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-go-'));
    fs.writeFileSync(path.join(tmp, 'go.mod'), 'module github.com/knadh/listmonk\n\ngo 1.21\n');
    const inv = scan(tmp);
    assert.equal(inv.title, 'listmonk');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('context does not infer external systems from packages or compose inventory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-c4-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'demo', dependencies: { express: '^4', pg: '^8' }
    }));
    fs.writeFileSync(
      path.join(tmp, 'docker-compose.yml'),
      'services:\n  app:\n    image: node\n  postgres:\n    image: postgres:16\n  redis:\n    image: redis:7\n'
    );
    fs.mkdirSync(path.join(tmp, 'app'));
    const inv = scan(tmp);
    const files = generateFiles(inv);
    const ctx = files['c4-context.md'];
    // express (npm dep) must NOT appear as System_Ext
    assert.doesNotMatch(ctx, /System_Ext\(ext_express/);
    assert.doesNotMatch(ctx, /System_Ext\(ext_pg/);
    assert.doesNotMatch(ctx, /System_Ext\(/);
    assert.match(files['c4-container.md'], /Container\(postgres/);
    assert.match(files['c4-container.md'], /Container\(redis/);
    assert.match(ctx, /static draft/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('c4-context does not repeat System id across subgraphs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-sysid-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo' }));
    const inv = scan(tmp);
    const files = generateFiles(inv);
    const ctx = files['c4-context.md'];
    const sysMatches = ctx.match(/\bSystem\(/g) || [];
    assert.equal(sysMatches.length, 1, 'one repository boundary, no invented deployment copy');
    assert.match(ctx, /System\(repo_system,/);
    assert.doesNotMatch(ctx, /sys_deploy|\bRel\(/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('drift term matching', () => {
  const inv = {
    modules: [
      { id: 'tools_model_loaders', label: 'tools/model_loaders', kind: 'module' },
      { id: 'cmd_openim_push', label: 'cmd/openim-push', kind: 'module' },
      { id: 'pkg_common', label: 'pkg/common', kind: 'module' },
      { id: 'worker', label: 'worker', kind: 'module' },
      { id: 'internal_rpc', label: 'internal/rpc', kind: 'module' },
      { id: 'internal_api', label: 'internal/api', kind: 'module' }
    ],
    services: [
      { id: 'openim_web', label: 'openim-web' },
      { id: 'openim_admin', label: 'openim-admin' },
      { id: 'openim_rpc', label: 'openim-rpc' },
      { id: 'openim_api', label: 'openim-api' }
    ],
    entrypoints: []
  };

  it('accepts leaf-name mention (LLM uses short dir name as node id)', () => {
    // chatchat case: C4 Component(model_loaders, "模型加载器", ...)
    const hay = 'Component(model_loaders, "模型加载器", "Python", "加载本地模型")';
    const r = checkDrift(inv, new Set(['model_loaders']), hay);
    assert.ok(!r.missing.some((m) => m.term === 'tools_model_loaders'),
      'leaf-name mention should satisfy tools/model_loaders');
  });

  it('treats hyphen and underscore as equivalent', () => {
    // dir openim-push, mermaid id openim_push
    const hay = 'Container(openim_push, "推送服务", "Go", "")';
    const r = checkDrift(inv, new Set(['openim_push']), hay);
    assert.ok(!r.missing.some((m) => m.term === 'cmd_openim_push'),
      'openim_push should match cmd/openim-push');
  });

  it('generic leaf names do not mask drift (pkg/common stays missing)', () => {
    // "common" appears as an unrelated label but pkg/common itself is absent
    const hay = 'Container(something_common, "通用组件", "Go", "")';
    const r = checkDrift(inv, new Set(), hay);
    assert.ok(r.missing.some((m) => m.term === 'pkg_common'),
      'generic leaf "common" must not satisfy pkg/common');
  });

  it('word-boundary: worker does not match worker_queue', () => {
    const hay = 'Container(worker_queue, "任务队列", "Go", "")';
    const r = checkDrift(inv, new Set(), hay);
    assert.ok(r.missing.some((m) => m.term === 'worker'),
      'worker must not match worker_queue substring');
  });

  it('accepts space-separated English service name (openim-web → "OpenIM Web")', () => {
    // c4-container renders compose service openim-web as Container(web, "OpenIM Web", ...)
    const hay = 'Container(web, "OpenIM Web", "Web", "Web 客户端")';
    const r = checkDrift(inv, new Set(), hay);
    assert.ok(!r.missing.some((m) => m.term === 'openim_web'),
      '"OpenIM Web" should satisfy compose service openim-web');
  });

  it('module internal/rpc is satisfied by deployment-unit name openim-rpc', () => {
    // C4 names the container "openim-rpc"; repo implementation lives in internal/rpc
    const hay = 'Container(rpc, "openim-rpc", "Go", "RPC 服务")';
    const r = checkDrift(inv, new Set(), hay);
    assert.ok(!r.missing.some((m) => m.term === 'internal_rpc'),
      '"openim-rpc" container should satisfy module internal/rpc');
    assert.ok(r.missing.some((m) => m.term === 'internal_api'),
      'generic leaf "api" must NOT get a service alias (real drift must stay visible)');
  });

  it('manifest entries (package.json/Cargo.toml) never produce drift terms', () => {
    // showcase-shop: Python app with a stray root package.json fixture —
    // manifests are project signals, not architecture units on the diagram.
    const minv = { services: [], modules: [], entrypoints: ['package.json', 'Cargo.toml'] };
    const r = checkDrift(minv, new Set(), 'flowchart TB\n  api["🧩 API"]');
    assert.equal(r.missing.length, 0,
      'package.json/Cargo.toml must not fire drift (got: ' +
        r.missing.map((m) => m.term).join(',') + ')');
  });

  it('nested entry (src/main.rs) is satisfied by path text in the diagram', () => {
    // id-style term "src_main" cannot match "src/main.rs" (slash separator);
    // basename alias "main" must match the <small> path citation.
    const minv = { services: [], modules: [], entrypoints: ['src/main.rs'] };
    const hay = 'rust_entry["🧩 Rust 入口<br/><small>src/main.rs</small>"]';
    const r = checkDrift(minv, new Set(), hay);
    assert.equal(r.missing.length, 0,
      'src/main.rs should be satisfied by path text (got: ' +
        r.missing.map((m) => m.term).join(',') + ')');
  });
});
