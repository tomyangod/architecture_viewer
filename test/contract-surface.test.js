'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { describeGreenLight } = require('../lib/green-light');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function makeFlaskRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-contract-'));
  fs.mkdirSync(path.join(dir, 'app', 'routes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'routes', 'todos.py'), [
    'from flask import Blueprint, jsonify',
    '',
    'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
    '',
    '@todos_bp.get("")',
    'def get_todos():',
    '    return jsonify([])',
    ''
  ].join('\n'));
  return dir;
}

describe('contract surface: public-surface-changed / schema-touched', () => {
  it('新增 Flask 路由 → public-surface-changed，只改函数体不报', () => {
    const dir = makeFlaskRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      fs.writeFileSync(path.join(dir, 'app', 'routes', 'todos.py'), [
        'from flask import Blueprint, jsonify',
        '',
        'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
        '',
        '@todos_bp.get("")',
        'def get_todos():',
        '    return jsonify([])',
        '',
        '@todos_bp.get("/export")',
        'def export_todos():',
        '    return jsonify({"ok": True})',
        ''
      ].join('\n'));
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /对外表面变更/);
      assert.match(r.stdout, /GET \/todos\/export/);

      r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      fs.writeFileSync(path.join(dir, 'app', 'routes', 'todos.py'), [
        'from flask import Blueprint, jsonify',
        '',
        'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
        '',
        '@todos_bp.get("")',
        'def get_todos():',
        '    return jsonify(["changed-body"])',
        '',
        '@todos_bp.get("/export")',
        'def export_todos():',
        '    return jsonify({"ok": False})',
        ''
      ].join('\n'));
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.ok(!/对外表面变更/.test(r.stdout), r.stdout);
      assert.match(r.stdout, /函数体实现差异|未判定业务对错|未检查业务逻辑/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('旧基线无 route 节点且文件未改 → 不把存量路由刷成对外表面变更', () => {
    const dir = makeFlaskRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      const baselinePath = path.join(dir, '.av', 'graph-baseline.json');
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      baseline.nodes = baseline.nodes.filter((n) => n.kind !== 'route');
      baseline.edges = baseline.edges.filter((e) => e.type !== 'handles' && !(e.to || '').startsWith('route:'));
      for (const n of baseline.nodes) {
        if (n.kind === 'file') delete n.contentHash;
      }
      fs.writeFileSync(baselinePath, JSON.stringify(baseline));
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.ok(!/对外表面变更/.test(r.stdout), r.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('新增 migration SQL → schema-touched', () => {
    const dir = makeFlaskRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'migrations', '001_init.sql'), 'CREATE TABLE todos (id INT);\n');
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /数据契约被改动/);
      assert.match(r.stdout, /001_init\.sql/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('绿灯文案带「未检查业务逻辑」', () => {
    const copy = describeGreenLight({ totalChanges: 0, sourceChanged: true });
    assert.match(copy.cli, /未检查业务逻辑/);
    assert.match(copy.mcp, /未检查业务逻辑/);
    assert.match(copy.pr, /未检查业务逻辑/);
  });
});
