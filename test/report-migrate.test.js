'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { migrateReport, assertReportContract } = require('../lib/report-contract');

describe('report schema migration', () => {
  it('upgrades v1 summary.riskLevel to risk.level + changeScale', () => {
    const v1 = {
      schemaVersion: 1,
      repo: 'demo',
      generatedAt: 't',
      baseFingerprint: 'a',
      headFingerprint: 'b',
      summary: { riskLevel: 'high', totalChanges: 3 },
      findings: [{ rule: 'layer-skip', severity: 'high' }],
      entities: [],
      edges: []
    };
    const v2 = migrateReport(v1);
    assert.equal(v2.schemaVersion, 2);
    assert.equal(v2.risk.level, 'high');
    assert.equal(v2.summary.changeScale, 'small');
    assert.ok(!('riskLevel' in v2.summary));
    assert.ok(Array.isArray(v2.structure.files));
    assert.doesNotThrow(() => assertReportContract(v2, { migrate: false }));
  });

  it('leaves schemaVersion 2 unchanged', () => {
    const cur = {
      schemaVersion: 2,
      repo: 'demo',
      generatedAt: 't',
      baseFingerprint: 'a',
      headFingerprint: 'b',
      summary: {
        addedNodes: 0, removedNodes: 0, modifiedNodes: 0, movedNodes: 0, renamedNodes: 0,
        addedEdges: 0, removedEdges: 0, reroutedEdges: 0,
        addedArchitecturalEdges: 0, removedArchitecturalEdges: 0,
        violations: 0, totalChanges: 0, changeScale: 'none'
      },
      risk: { level: 'none', findings: [] },
      entities: [], edges: [], modified: [], moved: [], renamed: [], rerouted: [],
      extAdded: [], extRemoved: [], layers: {}, structure: { files: [], deps: [] }
    };
    assert.equal(migrateReport(cur), cur);
  });

  it('assertReportContract({ migrate:true }) accepts a v1 payload after upgrade', () => {
    const v1 = {
      schemaVersion: 1,
      repo: 'demo',
      generatedAt: 't',
      baseFingerprint: 'a',
      headFingerprint: 'b',
      summary: {
        riskLevel: 'low',
        totalChanges: 1,
        addedNodes: 1, removedNodes: 0, modifiedNodes: 0, movedNodes: 0, renamedNodes: 0,
        addedEdges: 0, removedEdges: 0, reroutedEdges: 0,
        addedArchitecturalEdges: 0, removedArchitecturalEdges: 0,
        violations: 0
      },
      risk: { findings: [] },
      entities: [], edges: [], modified: [], moved: [], renamed: [], rerouted: [],
      extAdded: [], extRemoved: [], layers: {}
    };
    assert.doesNotThrow(() => assertReportContract(v1, { migrate: true }));
    assert.throws(() => assertReportContract(v1), /schemaVersion/);
  });
});
