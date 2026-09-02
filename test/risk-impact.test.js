'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRisk, summarizeFindings, SEVERITY } = require('../lib/risk-rules');
const { computeImpact } = require('../lib/impact');

function node(id, name, kind) {
  return { id, kind: kind || 'class', name: name || id, path: id, layer: 'service' };
}
function edge(from, to, type) {
  return { from, to, type: type || 'import' };
}

// 构建链式下游图：depN → ... → dep1 → target
function fanOutGraph(targetId, n) {
  const nodes = [node(targetId, targetId, 'class')];
  const edges = [];
  for (let i = 1; i <= n; i++) {
    const id = `dep${i}`;
    nodes.push(node(id, id, 'class'));
    edges.push(edge(id, targetId));
  }
  return { nodes, edges };
}

describe('B4 影响面驱动的风险分级', () => {
  test('broad-impact：≥10 下游生成 MEDIUM finding，≥20 升为 HIGH', () => {
    const base = { nodes: [], edges: [] };
    const head = fanOutGraph('file:target.js', 12);
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [],
      modifiedNodes: [{ id: 'file:target.js' }],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const impact = computeImpact(diff, base, head);
    const findings = evaluateRisk(diff, head, base, impact);
    const broad = findings.find((f) => f.rule === 'broad-impact');
    assert.ok(broad, '≥10 下游应产生 broad-impact finding');
    assert.equal(broad.severity, SEVERITY.MEDIUM);
    assert.equal(broad.impactDownstream, 12);
  });

  test('broad-impact：≥20 下游升为 HIGH', () => {
    const base = { nodes: [], edges: [] };
    const head = fanOutGraph('file:target.js', 25);
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [],
      modifiedNodes: [{ id: 'file:target.js' }],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const impact = computeImpact(diff, base, head);
    const findings = evaluateRisk(diff, head, base, impact);
    const broad = findings.find((f) => f.rule === 'broad-impact');
    assert.equal(broad.severity, SEVERITY.HIGH);
  });

  test('无 impact 参数时 broad-impact 规则不触发（兼容旧调用）', () => {
    const head = fanOutGraph('file:target.js', 15);
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [],
      modifiedNodes: [{ id: 'file:target.js' }],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const findings = evaluateRisk(diff, head, { nodes: [], edges: [] });
    const broad = findings.find((f) => f.rule === 'broad-impact');
    assert.equal(broad, undefined);
  });

  test('removed-type：下游 <3 时降为 LOW', () => {
    const base = {
      nodes: [node('file:victim.js', 'victim'), node('file:gone.js', 'gone')],
      edges: [edge('file:victim.js', 'file:gone.js')]
    };
    const head = { nodes: [node('file:victim.js', 'victim')], edges: [] };
    const diff = {
      addedNodes: [], renamedNodes: [], modifiedNodes: [],
      removedNodes: [{ id: 'file:gone.js' }],
      addedEdges: [], removedEdges: [edge('file:victim.js', 'file:gone.js')],
      addedTypes: [], removedTypes: [{ node: { id: 'file:gone.js', kind: 'class', name: 'gone', path: 'gone.js' } }],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const impact = computeImpact(diff, base, head);
    const findings = evaluateRisk(diff, head, base, impact);
    const rem = findings.find((f) => f.rule === 'removed-type');
    assert.equal(rem.severity, SEVERITY.LOW);
    assert.equal(rem.impactDownstream, 1);
  });

  test('removed-type：下游 ≥10 时升为 HIGH', () => {
    const base = fanOutGraph('file:gone.js', 12);
    const head = { nodes: [], edges: [] };
    const diff = {
      addedNodes: [], renamedNodes: [], modifiedNodes: [],
      removedNodes: [{ id: 'file:gone.js' }],
      addedEdges: [], removedEdges: base.edges,
      addedTypes: [], removedTypes: [{ node: { id: 'file:gone.js', kind: 'class', name: 'gone', path: 'gone.js' } }],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const impact = computeImpact(diff, base, head);
    const findings = evaluateRisk(diff, head, base, impact);
    const rem = findings.find((f) => f.rule === 'removed-type');
    assert.equal(rem.severity, SEVERITY.HIGH);
  });

  test('下游 <10 不产生 broad-impact finding', () => {
    const base = { nodes: [], edges: [] };
    const head = fanOutGraph('file:target.js', 5);
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [],
      modifiedNodes: [{ id: 'file:target.js' }],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const impact = computeImpact(diff, base, head);
    const findings = evaluateRisk(diff, head, base, impact);
    const broad = findings.find((f) => f.rule === 'broad-impact');
    assert.equal(broad, undefined);
  });

  test('summarizeFindings 反映 broad-impact HIGH 升级', () => {
    const base = { nodes: [], edges: [] };
    const head = fanOutGraph('file:target.js', 25);
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [],
      modifiedNodes: [{ id: 'file:target.js' }],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const impact = computeImpact(diff, base, head);
    const findings = evaluateRisk(diff, head, base, impact);
    const summary = summarizeFindings(findings);
    assert.equal(summary.level, 'high');
    assert.ok(summary.counts.high >= 1);
  });
});
