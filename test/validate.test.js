const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkFile, validateDir } = require('../lib/validate');
const { generateFiles } = require('../lib/generate');
const { scan } = require('../lib/scan');
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

  it('c4-context does not list npm deps as System_Ext', () => {
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
    // postgres and redis (infra services) SHOULD appear as System_Ext
    assert.match(ctx, /System_Ext\(ext_postgres/);
    assert.match(ctx, /System_Ext\(ext_redis/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('c4-context does not repeat System id across subgraphs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-sysid-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo' }));
    const inv = scan(tmp);
    const files = generateFiles(inv);
    const ctx = files['c4-context.md'];
    // Count occurrences of "System(sys, " — should be exactly 1 (子图1 only)
    const sysMatches = ctx.match(/System\(sys,/g) || [];
    assert.equal(sysMatches.length, 1, 'System(sys, ...) should appear exactly once');
    // 子图2 should use sys_deploy instead
    assert.match(ctx, /System\(sys_deploy,/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
