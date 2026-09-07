'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  evaluateRisk,
  loadSessionRules,
  SEVERITY
} = require('../lib/risk-rules');
const { loadRules } = require('../lib/rules');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'architecture-rules.example.yaml');
const CLI = path.join(ROOT, 'lib', 'cli.js');

function node(id, name, layer, kind) {
  return {
    id,
    kind: kind || 'class',
    name: name || id,
    path: id.replace(/^file:/, '') + (kind === 'file' ? '' : '.js'),
    layer
  };
}
function edge(from, to, type) {
  return { from, to, type: type || 'import', file: 'a.js', line: 1 };
}

describe('session 吃 architecture-rules.yaml（代码图层）', () => {
  it('forbid_cross_layer 对本轮新增 controller→storage import 亮 HIGH', () => {
    const rules = loadRules(EXAMPLE);
    const base = { nodes: [], edges: [] };
    const head = {
      nodes: [
        node('cls:Ctrl', 'Ctrl', 'controller'),
        node('cls:Repo', 'Repo', 'storage')
      ],
      edges: [edge('cls:Ctrl', 'cls:Repo', 'import')]
    };
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const findings = evaluateRisk(diff, head, base, null, { rules });
    const team = findings.find((f) => f.rule === 'no-controller-to-storage');
    assert.ok(team, '应产生团队规则 finding');
    assert.equal(team.severity, SEVERITY.HIGH);
    assert.equal(team.source, 'architecture-rules.yaml');
    assert.ok(team.message.includes('控制层') || team.message.includes('存储'));
  });

  it('无 forbid 命中时不报团队规则', () => {
    const rules = loadRules(EXAMPLE);
    const base = { nodes: [], edges: [] };
    const head = {
      nodes: [
        node('cls:Svc', 'Svc', 'service'),
        node('cls:Repo', 'Repo', 'storage')
      ],
      edges: [edge('cls:Svc', 'cls:Repo', 'import')]
    };
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const findings = evaluateRisk(diff, head, base, null, { rules });
    assert.equal(findings.filter((f) => f.source === 'architecture-rules.yaml').length, 0);
  });

  it('loadSessionRules 自动发现仓库根 architecture-rules.yaml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-rules-'));
    try {
      fs.copyFileSync(EXAMPLE, path.join(dir, 'architecture-rules.yaml'));
      const rules = loadSessionRules(dir);
      assert.ok(rules);
      assert.equal(rules.name, 'team-default');
      assert.ok(rules.forbid_cross_layer.some((r) => r.id === 'no-controller-to-storage'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadSessionRules(false) 禁用自动发现', () => {
    assert.equal(loadSessionRules(ROOT, false), null);
  });
});

describe('pre-commit 模板', () => {
  it('templates/pre-commit 存在且可执行语义完整', () => {
    const hook = path.join(ROOT, 'templates', 'pre-commit');
    assert.ok(fs.existsSync(hook));
    const body = fs.readFileSync(hook, 'utf8');
    assert.ok(body.includes('session report'));
    assert.ok(body.includes('graph-baseline.json'));
    assert.ok(body.includes('exit 1'));
  });
});

describe('CLI session report --rules', () => {
  it('help 文案含 --rules', () => {
    const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf8' });
    assert.ok(/session report.*--rules/s.test(out));
  });
});
