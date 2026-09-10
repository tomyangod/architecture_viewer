'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');
const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'architecture-rules.example.yaml');
const RULES_OK = path.join(ROOT, 'eval', 'fixtures', 'rules-ok');
const RULES_VIOLATE = path.join(ROOT, 'eval', 'fixtures', 'rules-violate');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-exit-'));
  fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'controllers', 'api.js'),
    'function handle(req) { return req; }\nmodule.exports = { handle };\n'
  );
  fs.writeFileSync(
    path.join(dir, 'models', 'db.js'),
    'class DB { save(x) { return x; } }\nmodule.exports = { DB };\n'
  );
  return dir;
}

function addCrossLayer(dir) {
  fs.writeFileSync(
    path.join(dir, 'models', 'db.js'),
    'const { handle } = require("../controllers/api");\n' +
    'class DB { save(x) { handle(x); return x; } }\n' +
    'module.exports = { DB };\n'
  );
}

describe('W16-02 CLI 退出码契约：session report', () => {
  it('0 无结构风险', () => {
    const dir = tmpRepo();
    try {
      assert.equal(run(['session', 'start', dir], dir).status, 0);
      const r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('1 跨层 HIGH', () => {
    const dir = tmpRepo();
    try {
      assert.equal(run(['session', 'start', dir], dir).status, 0);
      addCrossLayer(dir);
      const r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 1, r.stderr + r.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('2 非法 --fail-on / --renderer / --rules', () => {
    const dir = tmpRepo();
    try {
      assert.equal(run(['session', 'start', dir], dir).status, 0);
      assert.equal(run(['session', 'report', dir, '--fail-on', 'warning'], dir).status, 2);
      assert.equal(run(['session', 'report', dir, '--renderer', 'bogus'], dir).status, 2);
      assert.equal(run(['session', 'report', dir, '--rules', path.join(dir, 'no-such.yaml')], dir).status, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('3 报告文件被占成目录，写出失败', () => {
    const dir = tmpRepo();
    try {
      assert.equal(run(['session', 'start', dir], dir).status, 0);
      fs.mkdirSync(path.join(dir, '.av', 'session-report.json'));
      const r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 3, r.stderr + r.stdout);
      assert.match(r.stderr, /exit 3/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('4 无基线 / 基线损坏', () => {
    const dir = tmpRepo();
    try {
      const missing = run(['session', 'report', dir], dir);
      assert.equal(missing.status, 4);
      assert.match(missing.stderr, /exit 4|No baseline/);
      fs.mkdirSync(path.join(dir, '.av'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.av', 'graph-baseline.json'), '{not-json');
      const bad = run(['session', 'report', dir], dir);
      assert.equal(bad.status, 4);
      assert.match(bad.stderr, /corrupted|exit 4/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('W16-02 CLI 退出码契约：check', () => {
  it('0 合规套件', () => {
    const r = run(['check', RULES_OK, '--rules', EXAMPLE]);
    assert.equal(r.status, 0, r.stderr);
  });

  it('1 规则违规', () => {
    const r = run(['check', RULES_VIOLATE, '--rules', EXAMPLE]);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /no-controller-to-storage/);
  });

  it('2 --rules 文件不存在', () => {
    const r = run(['check', RULES_OK, '--rules', path.join(ROOT, 'no-such-rules.yaml')]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /exit 2|not found/i);
  });

  it('3 --drift --repo 指向普通文件', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-chk3-'));
    try {
      const file = path.join(dir, 'not-a-repo');
      fs.writeFileSync(file, 'x');
      const r = run(['check', RULES_OK, '--drift', '--repo', file]);
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, /exit 3|not a directory/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('4 无套件图 / --repo 不存在', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'av-chk4-'));
    try {
      const noKit = run(['check', empty]);
      assert.equal(noKit.status, 4, noKit.stderr);
      const ghost = run(['check', RULES_OK, '--drift', '--repo', path.join(empty, 'missing')]);
      assert.equal(ghost.status, 4, ghost.stderr);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('W16-02 CLI 退出码契约：diff', () => {
  it('0 两个相同仓', () => {
    const a = tmpRepo();
    const b = tmpRepo();
    try {
      const r = run(['diff', a, b]);
      assert.equal(r.status, 0, r.stderr + r.stdout);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it('1 跨层 HIGH', () => {
    const base = tmpRepo();
    const head = tmpRepo();
    try {
      addCrossLayer(head);
      const r = run(['diff', base, head]);
      assert.equal(r.status, 1, r.stderr + r.stdout);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(head, { recursive: true, force: true });
    }
  });

  it('2 缺参数 / 非法 --fail-on', () => {
    assert.equal(run(['diff']).status, 2);
    const dir = tmpRepo();
    try {
      assert.equal(run(['diff', dir, dir, '--fail-on', 'warning']).status, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('3 路径存在但不是目录也不是图 JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-diff3-'));
    try {
      const a = path.join(dir, 'a.py');
      const b = path.join(dir, 'b.py');
      fs.writeFileSync(a, 'x = 1\n');
      fs.writeFileSync(b, 'x = 2\n');
      const r = run(['diff', a, b]);
      assert.equal(r.status, 3, r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('4 路径不存在 / 图 JSON 损坏', () => {
    const missing = run(['diff', '/no/such/av-base', '/no/such/av-head']);
    assert.equal(missing.status, 4);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-diff4-'));
    try {
      const bad = path.join(dir, 'graph.json');
      fs.writeFileSync(bad, '{not-a-graph');
      const r = run(['diff', bad, bad]);
      assert.equal(r.status, 4, r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
