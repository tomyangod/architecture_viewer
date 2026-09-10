'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { extractTokens, applyIntentAlignment, writeSessionIntent, loadSessionIntent } = require('../lib/session-intent');
const { evaluateRisk } = require('../lib/risk-rules');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function makeFlask(dir) {
  fs.mkdirSync(path.join(dir, 'app', 'routes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'routes', 'todos.py'), [
    'from flask import Blueprint, jsonify',
    'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
    '@todos_bp.get("")',
    'def get_todos():',
    '    return jsonify([])',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'tests', 'test_todos.py'), 'def test_list():\n    assert True\n');
}

function addExportRoute(dir) {
  fs.writeFileSync(path.join(dir, 'app', 'routes', 'todos.py'), [
    'from flask import Blueprint, jsonify',
    'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
    '@todos_bp.get("")',
    'def get_todos():',
    '    return jsonify([])',
    '@todos_bp.get("/export")',
    'def export_todos():',
    '    return jsonify({"ok": True})',
    ''
  ].join('\n'));
}

describe('session intent alignment', () => {
  it('extractTokens 抽出路由与否定词不影响 token 列表', () => {
    const tokens = extractTokens('只修分层，不改 /todos');
    assert.ok(tokens.includes('/todos'), tokens.join(','));
  });

  it('applyIntentAlignment：声明不改 /todos 但新增该前缀路由 → low', () => {
    const findings = [];
    applyIntentAlignment(findings, {
      addedNodes: [{ node: { kind: 'route', name: 'GET /todos/export', path: 'app/routes/todos.py', id: 'route:x' } }],
      removedNodes: [],
      modifiedNodes: [],
      fileLocChanges: [{ path: 'app/routes/todos.py', delta: 4 }]
    }, { nodes: [], edges: [] }, { nodes: [], edges: [] }, {
      intentMeta: { text: '只修分层，不改 /todos', testFingerprint: null }
    });
    const hit = findings.find((f) => f.rule === 'intent-mismatch');
    assert.ok(hit);
    assert.equal(hit.severity, 'low');
    assert.match(hit.message, /不改/);
  });

  it('意图点名 billing 但只改 todos → info', () => {
    const findings = [];
    applyIntentAlignment(findings, {
      addedNodes: [{ node: { kind: 'route', name: 'GET /todos/export', path: 'app/routes/todos.py' } }],
      removedNodes: [],
      modifiedNodes: [],
      fileLocChanges: []
    }, { nodes: [], edges: [] }, { nodes: [], edges: [] }, {
      intentMeta: { text: '只改 billing 模块的分层', testFingerprint: null }
    });
    const hit = findings.find((f) => f.rule === 'intent-mismatch');
    assert.ok(hit);
    assert.equal(hit.severity, 'info');
  });

  it('CLI --intent 写入 session-intent.json；加 /todos/export 报意图不对齐', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-intent-'));
    try {
      makeFlask(dir);
      let r = run(['session', 'start', dir, '--intent', '只修分层，不改 /todos'], dir);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Session intent/);
      const rec = loadSessionIntent(dir);
      assert.equal(rec.text, '只修分层，不改 /todos');
      addExportRoute(dir);
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /意图不对齐/);
      assert.match(r.stdout, /对外表面变更/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('新增路由且测试未改 → behavior-untested；改测试则不报', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-intent2-'));
    try {
      makeFlask(dir);
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      addExportRoute(dir);
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /行为面变更但测试未动/);

      r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      fs.writeFileSync(path.join(dir, 'app', 'routes', 'todos.py'), [
        'from flask import Blueprint, jsonify',
        'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
        '@todos_bp.get("")',
        'def get_todos():',
        '    return jsonify([])',
        '@todos_bp.get("/export")',
        'def export_todos():',
        '    return jsonify({"ok": True})',
        '@todos_bp.get("/dump")',
        'def dump_todos():',
        '    return jsonify({})',
        ''
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'tests', 'test_todos.py'), 'def test_list():\n    assert True\ndef test_dump():\n    assert True\n');
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.ok(!/行为面变更但测试未动/.test(r.stdout), r.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无 intent 时 evaluateRisk 不报 intent-mismatch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-noint-'));
    try {
      writeSessionIntent(dir, null);
      const findings = evaluateRisk(
        { addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [], addedTypes: [], removedTypes: [], addedExternalDeps: [], removedExternalDeps: [], violations: [], summary: {} },
        { nodes: [], edges: [] },
        { nodes: [], edges: [] },
        null,
        { repo: dir }
      );
      assert.equal(findings.filter((f) => f.rule === 'intent-mismatch').length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
