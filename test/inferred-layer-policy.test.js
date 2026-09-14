'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings, loadSessionRules, suggestForFinding } = require('../lib/risk-rules');
const { shouldGate } = require('../lib/exit-codes');
const { formatSessionVerdict } = require('../lib/session-verdict');
const builtinAnalyzer = require('../lib/analyzers/builtin');

const CONFIG = 'config:.av/layers.json';
const empty = { nodes: [], edges: [] };

function crossing(fromLayer, toLayer, fromSignal, toSignal) {
  return {
    nodes: [
      { id: 'file:from.py', kind: 'file', name: 'from.py', path: 'from.py', layer: fromLayer, layerSignal: fromSignal },
      { id: 'file:to.py', kind: 'file', name: 'to.py', path: 'to.py', layer: toLayer, layerSignal: toSignal }
    ],
    edges: [{ from: 'file:from.py', to: 'file:to.py', type: 'import', file: 'from.py', line: 1 }]
  };
}

function fixture(t, files) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.inferred-layer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
  return dir;
}

for (const [fromLayer, toLayer, rule] of [
  ['util', 'service', 'cross-layer-violation'],
  ['controller', 'storage', 'layer-skip']
]) {
  for (const [fromSignal, toSignal] of [
    [undefined, undefined],
    ['dir-name', 'dir-name'],
    ['import:python-web-framework', 'import:sqlalchemy'],
    ['structure:high-fan-out', 'structure:high-fan-in'],
    [CONFIG, 'dir-name'],
    ['dir-name', CONFIG]
  ]) {
    test(`P2 ${rule}: ${fromSignal}/${toSignal} is visible review evidence, never a gate`, () => {
      const head = crossing(fromLayer, toLayer, fromSignal, toSignal);
      for (const mode of ['incremental', 'snapshot']) {
        const findings = evaluateRisk(diffGraphs(empty, head), head, empty, null, { mode });
        const finding = findings.find((f) => f.rule === rule);
        assert.ok(finding);
        assert.equal(finding.severity, 'medium');
        assert.equal(finding.reportOnly, true);
        assert.equal(finding.layerConfirmation, 'unconfirmed');
        assert.equal(finding.fromLayerSignal, fromSignal || null);
        assert.equal(finding.toLayerSignal, toSignal || null);
        assert.match(finding.message, /未经人工配置确认.*仅作审查提示.*不阻断/);
        assert.match(suggestForFinding(finding), /先核对实际职责/);
        assert.doesNotMatch(suggestForFinding(finding), /必须反转|请反转依赖方向/);
        const summary = summarizeFindings(findings);
        assert.equal(summary.level, 'medium');
        assert.equal(summary.gateLevel, 'none');
        assert.equal(summary.reportOnlyCount, findings.length);
        for (const failOn of ['high', 'medium', 'low']) {
          assert.equal(shouldGate(summary.gateLevel, failOn), false);
        }
        assert.equal(formatSessionVerdict({ riskSummary: summary, findings }).level, 'medium');
      }
    });
  }

  test(`P2 ${rule}: both explicitly configured endpoints retain HIGH gating`, () => {
    const head = crossing(fromLayer, toLayer, CONFIG, CONFIG);
    const findings = evaluateRisk(diffGraphs(empty, head), head, empty);
    const finding = findings.find((f) => f.rule === rule);
    assert.equal(finding.severity, 'high');
    assert.notEqual(finding.reportOnly, true);
    assert.equal(finding.layerConfirmation, 'configured');
    assert.equal(summarizeFindings(findings).gateLevel, 'high');
  });
}

test('P2 layer-name team policy does not confirm inferred endpoint roles', t => {
  const repo = fixture(t, {
    'architecture-rules.yaml': [
      'forbid_cross_layer:',
      '  - id: monitoring-must-not-import-service',
      '    from: util',
      '    to: service',
      '    message: Monitoring must not depend on services',
      ''
    ].join('\n')
  });
  for (const [fromSignal, toSignal] of [
    ['dir-name', 'dir-name'], [CONFIG, 'dir-name'], ['dir-name', CONFIG], [CONFIG, CONFIG]
  ]) {
    const confirmed = fromSignal === CONFIG && toSignal === CONFIG;
    const head = crossing('util', 'service', fromSignal, toSignal);
    const findings = evaluateRisk(diffGraphs(empty, head), head, empty, null, {
      rules: loadSessionRules(repo, path.join(repo, 'architecture-rules.yaml'))
    });
    const team = findings.find((f) => f.rule === 'monitoring-must-not-import-service');
    assert.equal(team.source, 'architecture-rules.yaml');
    assert.equal(team.severity, confirmed ? 'high' : 'medium');
    assert.equal(!!team.reportOnly, !confirmed);
    assert.equal(team.layerConfirmation, confirmed ? 'configured' : 'unconfirmed');
    assert.equal(summarizeFindings(findings).gateLevel, confirmed ? 'high' : 'none');
    if (!confirmed) {
      assert.match(team.title, /分层未确认/);
      assert.match(suggestForFinding(team), /仅有层名禁令不代表分层已确认/);
      assert.doesNotMatch(team.message, /must not depend|必须反转|不得依赖/);
    }
  }
});

test('P2 actual tools/monitoring inference is review-only; explicit layers confirm the same dependency', t => {
  const repo = fixture(t, {
    'tools/monitoring/check.py': 'class Monitor:\n    pass\n',
    'services/publisher.py': 'from tools.monitoring.check import Monitor\nclass Publisher:\n    pass\n'
  });
  const inferred = buildGraph(repo);
  const reviews = evaluateRisk(diffGraphs(empty, inferred), inferred, empty, null, { mode: 'snapshot' });
  const review = reviews.find((f) => f.rule === 'cross-layer-violation');
  assert.ok(review);
  assert.equal(review.fromLayerSignal, 'dir-name');
  assert.equal(review.severity, 'medium');
  assert.equal(review.reportOnly, true);

  fs.mkdirSync(path.join(repo, '.av'));
  fs.writeFileSync(path.join(repo, '.av/layers.json'), JSON.stringify({
    'tools/monitoring': 'entrypoint', services: 'service'
  }));
  const confirmed = buildGraph(repo);
  const risks = evaluateRisk(diffGraphs(empty, confirmed), confirmed, empty, null, { mode: 'snapshot' });
  const violation = risks.find((f) => f.rule === 'cross-layer-violation');
  assert.equal(violation.layerConfirmation, 'configured');
  assert.equal(violation.severity, 'high');
  assert.equal(summarizeFindings(risks).gateLevel, 'high');
});

test('P2 explicit Import Linter contract overrides a duplicate inferred-layer review', t => {
  const repo = fixture(t, {
    '.importlinter': [
      '[importlinter:contract:layers]',
      'name = Confirmed architecture',
      'type = layers',
      'layers =',
      '    to',
      '    from',
      ''
    ].join('\n')
  });
  const head = crossing('util', 'service', 'dir-name', 'dir-name');
  const diff = diffGraphs(empty, head);
  const result = builtinAnalyzer.analyze(repo, { current: head, baseline: empty, diff, rules: null });
  const hits = result.violations.filter((f) => f.rule === 'cross-layer-violation');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].importLinterType, 'layers');
  assert.equal(hits[0].severity, 'high');
  assert.notEqual(hits[0].reportOnly, true);
  assert.equal(summarizeFindings(result.violations).gateLevel, 'high');
});

test('P2 CLI fail-on=medium does not block unconfirmed layers and keeps the review visible', t => {
  const repo = fixture(t, {
    'tools/monitoring/check.py': 'class Monitor:\n    pass\n',
    'services/publisher.py': 'class Publisher:\n    pass\n'
  });
  const bin = path.join(__dirname, '../bin/arch-viewer.js');
  const run = (args) => spawnSync(process.execPath, [bin, ...args], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, AV_BASELINE: 'snapshot', DEEPSEEK_API_KEY: '' }
  });
  const started = run(['session', 'start', repo]);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  fs.writeFileSync(path.join(repo, 'services/publisher.py'),
    'from tools.monitoring.check import Monitor\nclass Publisher:\n    pass\n');
  const result = run(['session', 'report', repo, '--renderer', 'builtin', '--fail-on', 'medium']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(repo, '.av/session-report.json'), 'utf8'));
  assert.equal(report.riskSummary.level, 'medium');
  assert.equal(report.riskSummary.gateLevel, 'none');
  assert.ok(report.findings.some((f) => f.rule === 'cross-layer-violation' && f.reportOnly));
  assert.match(result.stdout, /分层未确认/);
});
