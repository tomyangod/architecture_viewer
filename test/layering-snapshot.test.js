'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk } = require('../lib/risk-rules');
const { toolCheckLayering, toolExplainFinding } = require('../mcp/server');
const { getRuntimeIdentity } = require('../lib/runtime-identity');

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return root;
}

it('snapshot separates historical inventory from risk and does not claim changes', t => {
  const repo = fixture(t, {
    'service.py': 'import pandas as pd\nclass Service:\n    pass\n' + '# volume\n'.repeat(2200)
  });
  const result = toolCheckLayering({ repo });
  assert.equal(result.mode, 'snapshot');
  assert.equal(result.baselineKind, 'none');
  assert.equal(result.changeAttribution, 'unknown');
  assert.ok(result.inventory.externalDependencies.some(item => item.name === 'pandas'));
  assert.ok(result.inventory.fileSizes.some(item => item.file === 'service.py'));
  assert.ok(result.inventory.orphanEntities.length > 0);
  assert.ok(!result.findings.some(item => ['new-external-dep', 'god-file', 'large-file', 'orphan-entity'].includes(item.rule)));
  assert.equal(result.layerViolationCount, 0);
  assert.match(result.message, /不能判定.*本轮/);
  assert.equal(result.riskCount, result.findings.length);
});

it('snapshot keeps true cross-layer evidence and explanation indices aligned', t => {
  const repo = fixture(t, {
    '.av/layers.json': JSON.stringify({ controllers: 'controller', storage: 'storage' }),
    'controllers/app.py': 'from storage.store import Store\nclass App:\n    store: Store\n',
    'storage/store.py': 'class Store:\n    pass\n'
  });
  const result = toolCheckLayering({ repo });
  assert.ok(result.layerViolationCount > 0);
  const index = result.breakdown.layerViolations.findingIndices[0];
  const explanation = toolExplainFinding({ repo, index });
  assert.equal(explanation.mode, 'snapshot');
  assert.ok(explanation.edgeEvidence, JSON.stringify(explanation));
  assert.equal(result.runtime.analyzerSourceDigest, explanation.runtime.analyzerSourceDigest);
});

it('qualified external Event never creates a same-name local crossing', t => {
  const repo = fixture(t, {
    'services/worker.py': 'import threading\nclass Worker:\n    event: threading.Event\n',
    'tools/monitoring/check.py': 'class Event:\n    pass\n'
  });
  const result = toolCheckLayering({ repo });
  assert.equal(result.layerViolationCount, 0);
  assert.ok(!result.inventory.externalDependencies.some(item => item.name === 'Event'));
});

it('incremental reports still flag genuinely introduced dependencies', t => {
  const repo = fixture(t, { 'app.py': 'class App:\n    pass\n' });
  const base = buildGraph(repo);
  fs.appendFileSync(path.join(repo, 'app.py'), '\nimport pandas as pd\n');
  const head = buildGraph(repo);
  const delta = diffGraphs(base, head);
  assert.ok(evaluateRisk(delta, head, base).some(item => item.rule === 'new-external-dep'));
  assert.ok(!evaluateRisk(delta, head, base, null, { mode: 'snapshot' })
    .some(item => item.rule === 'new-external-dep'));
});

it('runtime identity identifies actual installed code without depending on git', () => {
  const first = getRuntimeIdentity();
  const second = getRuntimeIdentity();
  assert.equal(first.packageVersion, require('../package.json').version);
  assert.equal(first.packageRoot, fs.realpathSync(path.join(__dirname, '..')));
  assert.match(first.analyzerSourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.analyzerSourceDigest, second.analyzerSourceDigest);
  assert.ok(Number.isFinite(Date.parse(first.scannedAt)));
});
