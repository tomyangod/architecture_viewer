'use strict';

// Rule 13: 分层配置无法读取时必须显式告警（MEDIUM），不得静默降级为目录推断。
// 覆盖 W16-03 收尾缺口：stats.layerConfigError 之前存入 graph 但无人消费。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRisk } = require('../lib/risk-rules');

const emptyDiff = {
  violations: [],
  addedEdges: [],
  removedTypes: [],
  addedExternalDeps: [],
  addedTypes: [],
  fileLocChanges: []
};

function graph(stats) {
  return { nodes: [], edges: [], stats: stats || {} };
}

describe('Rule 13: layer-config-error', () => {
  it('head graph stats 含 layerConfigError 时产生 MEDIUM finding', () => {
    const head = graph({ files: 10, layerConfigError: 'Cannot load .av/layers.json: Unexpected token' });
    const findings = evaluateRisk(emptyDiff, head, graph({}), null, { rules: false });
    const f = findings.find((x) => x.rule === 'layer-config-error');
    assert.ok(f, '应产生 layer-config-error finding: ' + JSON.stringify(findings.map((x) => x.rule)));
    assert.equal(f.severity, 'medium');
    assert.ok(f.message.includes('layers.json'));
    assert.ok(f.detail.includes('Unexpected token'));
    assert.ok(f.suggestion, '应给出修复建议');
  });

  it('配置正常时不产生该 finding', () => {
    const head = graph({ files: 10 });
    const findings = evaluateRisk(emptyDiff, head, graph({}), null, { rules: false });
    assert.equal(findings.some((x) => x.rule === 'layer-config-error'), false);
  });

  it('基线已存在同样错误时标记为"仍无法读取"', () => {
    const err = 'Cannot load .av/layers.json: bad json';
    const head = graph({ files: 10, layerConfigError: err });
    const base = graph({ files: 9, layerConfigError: err });
    const findings = evaluateRisk(emptyDiff, head, base, null, { rules: false });
    const f = findings.find((x) => x.rule === 'layer-config-error');
    assert.ok(f);
    assert.ok(f.title.includes('仍'), '存量错误标题应区分: ' + f.title);
  });
});
