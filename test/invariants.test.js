'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { evaluateRisk, SEVERITY, suggestForFinding } = require('../lib/risk-rules');
const { loadRules, normalizeRules } = require('../lib/rules');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');
const EXAMPLE = path.join(__dirname, '..', 'architecture-rules.example.yaml');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function node(id, name, layer, kind, extra) {
  return {
    id,
    kind: kind || 'class',
    name: name || id,
    path: (extra && extra.path) || (id.replace(/^file:/, '') + (kind === 'file' ? '' : '.js')),
    layer,
    ...(extra || {})
  };
}

describe('architecture-rules invariants', () => {
  it('normalizeRules 加载 invariants；缺 forbid/require 的条目显式报错', () => {
    const rules = normalizeRules({
      invariants: [
        { id: 'ok', when: { route: '*' }, forbid: { to_layer: 'storage' } },
        { id: 'req', when: { route: 'GET /x' }, require: { calls_through_layer: 'service' } }
      ]
    });
    assert.equal(rules.invariants.length, 2);
    assert.equal(rules.invariants[0].id, 'ok');
    assert.equal(rules.invariants[1].require.import_layer, 'service');
    assert.throws(() => normalizeRules({ invariants: [{ id: 'bad', message: 'no teeth' }] }), {
      code: 'RULES_CONFIG_ERROR'
    });
  });

  it('example.yaml 含 new-route-no-direct-storage', () => {
    const rules = loadRules(EXAMPLE);
    assert.ok(rules.invariants.some((i) => i.id === 'new-route-no-direct-storage'));
  });

  it('when.route 命中且新增 import→storage → invariant-broken', () => {
    const rules = {
      invariants: [{
        id: 'route-no-storage',
        message: '路由文件不得直连存储',
        when: { route: 'GET /todos*' },
        forbid: { to_layer: 'storage', edge_type: 'import' }
      }]
    };
    const route = node('route:app/routes/todos.py:GET /todos/export', 'GET /todos/export', 'controller', 'route', {
      path: 'app/routes/todos.py', line: 10, contentHash: 'h1'
    });
    const file = node('file:app/routes/todos.py', 'todos.py', 'controller', 'file', {
      path: 'app/routes/todos.py', contentHash: 'h1'
    });
    const repo = node('file:app/database/repo.py', 'repo.py', 'storage', 'file', { path: 'app/database/repo.py' });
    const base = {
      nodes: [
        node('file:app/routes/todos.py', 'todos.py', 'controller', 'file', {
          path: 'app/routes/todos.py', contentHash: 'h0'
        })
      ],
      edges: []
    };
    const head = {
      nodes: [file, route, repo],
      edges: [
        { from: 'file:app/routes/todos.py', to: 'file:app/database/repo.py', type: 'import', file: 'app/routes/todos.py', line: 2 },
        { from: 'file:app/routes/todos.py', to: route.id, type: 'handles', file: 'app/routes/todos.py', line: 10 }
      ]
    };
    const diff = {
      addedNodes: [{ id: route.id, node: route }],
      removedNodes: [],
      addedEdges: [head.edges[0]],
      removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const findings = evaluateRisk(diff, head, base, null, { rules });
    const hit = findings.find((f) => f.rule === 'invariant-broken');
    assert.ok(hit, findings.map((f) => f.rule + ':' + f.message).join('|'));
    assert.equal(hit.severity, SEVERITY.HIGH);
    assert.equal(hit.title, '团队不变量');
    assert.equal(hit.invariantId, 'route-no-storage');
    assert.match(suggestForFinding(hit), /不变量/);
  });

  it('when.route 未命中本轮新增路由 → 不报', () => {
    const rules = {
      invariants: [{
        id: 'only-alerts',
        when: { route: 'POST /alerts' },
        forbid: { to_layer: 'storage', edge_type: 'import' }
      }]
    };
    const route = node('route:r:GET /todos', 'GET /todos', 'controller', 'route', {
      path: 'r.py', contentHash: 'a'
    });
    const base = { nodes: [node('file:r.py', 'r.py', 'controller', 'file', { path: 'r.py', contentHash: 'b' })], edges: [] };
    const head = {
      nodes: [
        node('file:r.py', 'r.py', 'controller', 'file', { path: 'r.py', contentHash: 'a' }),
        route,
        node('file:db.py', 'db.py', 'storage', 'file', { path: 'db.py' })
      ],
      edges: [{ from: 'file:r.py', to: 'file:db.py', type: 'import', file: 'r.py', line: 1 }]
    };
    const diff = {
      addedNodes: [{ id: route.id, node: route }],
      removedNodes: [],
      addedEdges: head.edges,
      removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const findings = evaluateRisk(diff, head, base, null, { rules });
    assert.equal(findings.filter((f) => f.rule === 'invariant-broken').length, 0);
  });

  it('require.import_layer：新路由文件未 import service → 红灯；有则绿', () => {
    const rules = {
      invariants: [{
        id: 'need-service',
        message: '新路由必须经 service',
        when: { route: '*' },
        require: { import_layer: 'service' }
      }]
    };
    const route = node('route:ctrl.py:GET /x', 'GET /x', 'controller', 'route', {
      path: 'ctrl.py', contentHash: 'n'
    });
    const base = {
      nodes: [node('file:ctrl.py', 'ctrl.py', 'controller', 'file', { path: 'ctrl.py', contentHash: 'o' })],
      edges: []
    };
    const headNo = {
      nodes: [
        node('file:ctrl.py', 'ctrl.py', 'controller', 'file', { path: 'ctrl.py', contentHash: 'n' }),
        route
      ],
      edges: [{ from: 'file:ctrl.py', to: route.id, type: 'handles', file: 'ctrl.py', line: 1 }]
    };
    const diffNo = {
      addedNodes: [{ id: route.id, node: route }],
      removedNodes: [], addedEdges: [], removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    let findings = evaluateRisk(diffNo, headNo, base, null, { rules });
    assert.ok(findings.some((f) => f.rule === 'invariant-broken' && /service/.test(f.detail)));

    const headYes = {
      nodes: [
        ...headNo.nodes,
        node('file:svc.py', 'svc.py', 'service', 'file', { path: 'svc.py' })
      ],
      edges: [
        ...headNo.edges,
        { from: 'file:ctrl.py', to: 'file:svc.py', type: 'import', file: 'ctrl.py', line: 2 }
      ]
    };
    findings = evaluateRisk(diffNo, headYes, base, null, { rules });
    assert.equal(findings.filter((f) => f.rule === 'invariant-broken').length, 0);
  });

  it('CLI：配置 invariants 后新增路由并直连 storage 出现团队不变量', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-inv-'));
    try {
      fs.mkdirSync(path.join(dir, 'app', 'routes'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'app', 'database'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'app', 'database', 'repo.py'), 'class Repo:\n    pass\n');
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
      fs.writeFileSync(path.join(dir, 'architecture-rules.yaml'), [
        'version: 1',
        'name: inv-demo',
        'invariants:',
        '  - id: route-no-storage',
        '    message: 路由不得直连存储',
        '    when:',
        '      route: "*"',
        '    forbid:',
        '      to_layer: storage',
        '      edge_type: import',
        ''
      ].join('\n'));
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      fs.writeFileSync(path.join(dir, 'app', 'routes', 'todos.py'), [
        'from flask import Blueprint, jsonify',
        'from app.database.repo import Repo',
        '',
        'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
        '',
        '@todos_bp.get("")',
        'def get_todos():',
        '    return jsonify([])',
        '',
        '@todos_bp.get("/export")',
        'def export_todos():',
        '    return jsonify({"repo": Repo})',
        ''
      ].join('\n'));
      r = run(['session', 'report', dir, '--renderer', 'builtin', '--fail-on', 'none'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /团队不变量/);
      assert.match(r.stdout, /路由不得直连存储/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
