'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadRules } = require('../lib/rules');
const { evaluateRisk, resolveRiskPolicy } = require('../lib/risk-rules');
const { computeImpact } = require('../lib/impact');

function node(id, name, kind) {
  return { id, kind: kind || 'class', name: name || id, path: id.replace(/^file:/, ''), layer: 'service' };
}
function edge(from, to, type) {
  return { from, to, type: type || 'import' };
}
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

describe('risk policy from architecture-rules.yaml', () => {
  it('example yaml loads default thresholds', () => {
    const rules = loadRules(path.join(__dirname, '..', 'architecture-rules.example.yaml'));
    assert.equal(rules.risk.thresholds.broad_impact, 10);
    assert.equal(rules.risk.thresholds.removed_type_low, 3);
    assert.deepEqual(rules.risk.disable, []);
  });

  it('disable drops a rule; exclude skips matching files', () => {
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
    const off = evaluateRisk(diff, head, base, impact, {
      rules: { risk: { disable: ['broad-impact'] } }
    });
    assert.equal(off.find((f) => f.rule === 'broad-impact'), undefined);

    const godDiff = {
      addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [],
      addedEdges: [], removedEdges: [], addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [], violations: [], summary: {},
      fileLocChanges: [{
        path: 'vendor/huge.js', baseLoc: 10, headLoc: 900, delta: 890, deltaPercent: 8900, existedInBase: true
      }]
    };
    const excluded = evaluateRisk(godDiff, { nodes: [], edges: [] }, { nodes: [], edges: [] }, null, {
      rules: { risk: { exclude: [{ rule: 'god-file', path: 'vendor/**' }] } }
    });
    assert.equal(excluded.find((f) => f.rule === 'god-file'), undefined);
    const kept = evaluateRisk(godDiff, { nodes: [], edges: [] }, { nodes: [], edges: [] }, null, {
      rules: { risk: { exclude: [{ rule: 'god-file', path: 'src/**' }] } }
    });
    assert.ok(kept.find((f) => f.rule === 'god-file'));
  });

  it('custom broad_impact threshold changes the trigger', () => {
    const base = { nodes: [], edges: [] };
    const head = fanOutGraph('file:target.js', 6);
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [],
      modifiedNodes: [{ id: 'file:target.js' }],
      addedEdges: head.edges, removedEdges: [],
      addedTypes: [], removedTypes: [],
      addedExternalDeps: [], removedExternalDeps: [],
      violations: [], summary: {}
    };
    const impact = computeImpact(diff, base, head);
    const tight = evaluateRisk(diff, head, base, impact, {
      rules: { risk: { thresholds: { broad_impact: 5, broad_impact_high: 20 } } }
    });
    assert.ok(tight.find((f) => f.rule === 'broad-impact'));
    const policy = resolveRiskPolicy({ risk: { thresholds: { broad_impact: 5 } } });
    assert.equal(policy.thresholds.broad_impact, 5);
    assert.equal(policy.thresholds.broad_impact_high, 20);
  });
});
