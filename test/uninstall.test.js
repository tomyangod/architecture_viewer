'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'cli.js');
const { installProjectGate } = require('../lib/setup-project');
const { writeDshPatch, resolveLauncher } = require('../lib/setup');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(homeDir, extraArgs = [], extraEnv = {}) {
  return execFileSync('node', [CLI, ...extraArgs], {
    env: { ...process.env, HOME: homeDir, ...extraEnv },
    encoding: 'utf8'
  });
}

describe('uninstall: 用户级 MCP', () => {
  let home;
  before(() => { home = tmpDir('av-un-'); });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('卸掉 arch-viewer，保留其它 MCP', () => {
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    const cfgPath = path.join(cursorDir, 'mcp.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      mcpServers: {
        'mcp-server-chart': { command: 'npx', args: ['-y', 'chart'] },
        'arch-viewer': { command: 'node', args: ['/tmp/mcp/server.js'] }
      }
    }));

    const out = run(home, ['uninstall']);
    assert.ok(out.includes('卸载'));
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.ok(!cfg.mcpServers['arch-viewer']);
    assert.ok(cfg.mcpServers['mcp-server-chart'], '其它 MCP 必须保留');
    assert.ok(fs.existsSync(cfgPath + '.av-bak'));
  });

  it('重复卸载幂等', () => {
    const out = run(home, ['uninstall']);
    assert.ok(out.includes('本来就没有') || out.includes('跳过'));
  });
});

describe('uninstall: dsh patch', () => {
  let home;
  before(() => { home = tmpDir('av-un-dsh-'); });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('只删 mcp-arch-viewer，保留其它 insert', () => {
    const p = path.join(home, '.dsh', 'profiles', 'headless');
    fs.mkdirSync(p, { recursive: true });
    const patchPath = path.join(p, 'cordis.patch.yml');
    fs.writeFileSync(patchPath, [
      '- insert:',
      '    - id: some-other-plugin',
      "      name: '@example/some-plugin'",
      ''
    ].join('\n'));
    writeDshPatch(patchPath, resolveLauncher(() => { throw new Error('no npm'); }));
    assert.ok(fs.readFileSync(patchPath, 'utf8').includes('mcp-arch-viewer'));

    const out = run(home, ['uninstall']);
    assert.ok(out.includes('DeepSeek Harness'));
    const patch = fs.readFileSync(patchPath, 'utf8');
    assert.ok(!patch.includes('mcp-arch-viewer'));
    assert.ok(patch.includes('some-other-plugin'));
  });
});

describe('uninstall: 项目级', () => {
  let repo;
  afterEach(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  it('卸 hooks / 规则 / 项目 MCP，保留用户自有 AGENTS 正文', () => {
    repo = tmpDir('av-un-proj-');
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Team\n\nkeep me\n');
    installProjectGate(repo, { mcp: true });
    fs.writeFileSync(path.join(repo, '.cursor', 'mcp.json'), JSON.stringify({
      mcpServers: {
        other: { command: 'npx' },
        'arch-viewer': { command: 'node', args: ['x'] }
      }
    }));

    const home = tmpDir('av-un-home-');
    try {
      const out = run(home, ['uninstall', repo]);
      assert.ok(out.includes('已卸') || out.includes('卸载'));
      const hooks = JSON.parse(fs.readFileSync(path.join(repo, '.cursor', 'hooks.json'), 'utf8'));
      assert.ok(!hooks.hooks || !hooks.hooks.stop);
      const mcp = JSON.parse(fs.readFileSync(path.join(repo, '.cursor', 'mcp.json'), 'utf8'));
      assert.ok(!mcp.mcpServers['arch-viewer']);
      assert.ok(mcp.mcpServers.other);
      const agents = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
      assert.ok(agents.includes('keep me'));
      assert.ok(!agents.includes('arch-viewer-gate'));
      assert.ok(!fs.existsSync(path.join(repo, '.cursor', 'rules', 'architecture-session.mdc')));
      assert.ok(!fs.existsSync(path.join(repo, '.av', 'AGENT-GATE.md')));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('--purge 删会话产物，保留 layers.json', () => {
    repo = tmpDir('av-un-purge-');
    fs.mkdirSync(path.join(repo, '.av'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.av', 'graph-baseline.json'), '{}');
    fs.writeFileSync(path.join(repo, '.av', 'layers.json'), '{"app":"service"}');
    fs.writeFileSync(path.join(repo, '.av', 'session-report.html'), '<html></html>');
    const home = tmpDir('av-un-home2-');
    try {
      run(home, ['uninstall', repo, '--purge']);
      assert.ok(!fs.existsSync(path.join(repo, '.av', 'graph-baseline.json')));
      assert.ok(!fs.existsSync(path.join(repo, '.av', 'session-report.html')));
      assert.ok(fs.existsSync(path.join(repo, '.av', 'layers.json')));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('uninstall: --npm', () => {
  it('调用传入的 exec，不真卸本机包', () => {
    const { tryNpmUninstall } = require('../lib/uninstall');
    let called = '';
    const r = tryNpmUninstall((cmd) => {
      called = cmd;
      return 'removed 1 package\n';
    });
    assert.equal(r.status, 'removed');
    assert.match(called, /npm uninstall -g arch-viewer/);
  });
});
