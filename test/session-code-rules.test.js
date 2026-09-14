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
const { buildReportData } = require('../lib/session-report');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'architecture-rules.example.yaml');
const CLI = path.join(ROOT, 'lib', 'cli.js');

function node(id, name, layer, kind) {
  return {
    id,
    kind: kind || 'class',
    name: name || id,
    path: id.replace(/^file:/, '') + (kind === 'file' ? '' : '.js'),
    layer,
    layerSignal: 'config:.av/layers.json'
  };
}
function edge(from, to, type) {
  return { from, to, type: type || 'import', file: 'a.js', line: 1 };
}

describe('session 吃 architecture-rules.yaml（代码图层）', () => {
  it('forbid_cross_layer 对两端已确认的新增 controller→storage import 亮 HIGH', () => {
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
    assert.equal(team.from, 'cls:Ctrl');
    assert.equal(team.to, 'cls:Repo');
    assert.equal(team.edgeType, 'import');
  });

  it('团队 forbid_cross_layer finding 在报告中标记对应违规边', () => {
    const from = node('file:services/order.py', 'order.py', 'service', 'file');
    const to = node('file:database/db.py', 'db.py', 'storage', 'file');
    const addedEdge = edge(from.id, to.id, 'import');
    const base = { nodes: [], edges: [], stats: {}, fingerprint: 'base' };
    const head = { nodes: [from, to], edges: [addedEdge], stats: {}, fingerprint: 'head' };
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [], movedNodes: [],
      addedEdges: [addedEdge], removedEdges: [], reroutedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [],
      summary: {
        addedNodes: 0, removedNodes: 0, modifiedNodes: 0, movedNodes: 0, renamedNodes: 0,
        addedEdges: 1, removedEdges: 0, reroutedEdges: 0,
        addedTypes: 0, removedTypes: 0, addedPackages: 0, removedPackages: 0,
        addedExternalDeps: 0, removedExternalDeps: 0, violations: 0, totalChanges: 1
      }
    };
    const rules = {
      forbid_cross_layer: [{
        id: 'team-service-storage',
        from: 'service',
        to: 'storage',
        message: '服务层不得直接访问存储层'
      }]
    };
    const findings = evaluateRisk(diff, head, base, null, { rules });
    const data = buildReportData(base, head, diff, findings, null, 'team-rule-report', null);
    const reportEdge = data.edges.find((item) => item.from === from.id && item.to === to.id);

    assert.equal(diff.violations.length, 0, '默认 diff 规则不应制造这条违规');
    assert.ok(findings.some((finding) => finding.rule === 'team-service-storage'));
    assert.ok(reportEdge, '新增文件 import 应进入报告图');
    assert.equal(reportEdge.violation, true, '团队规则命中的边必须进入“仅违规”过滤');
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
