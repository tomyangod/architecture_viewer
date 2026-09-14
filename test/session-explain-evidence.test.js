'use strict';

const { it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  toolSessionStart, toolSessionGuard, toolExplainFinding, buildExplainResult, stopWatcher
} = require('../mcp/server');
const { buildSessionReportJson } = require('../lib/session-report');

const previousBaseline = process.env.AV_BASELINE;
before(() => { delete process.env.AV_BASELINE; });
after(() => {
  if (previousBaseline === undefined) delete process.env.AV_BASELINE;
  else process.env.AV_BASELINE = previousBaseline;
});

it('preserves test evidence metadata through JSON and MCP explanation formatting', () => {
  const finding = {
    rule: 'behavior-changed-no-test', severity: 'medium', title: 'Review behavior',
    message: 'Static test association is not execution evidence',
    testEvidence: 'unchanged-associated-tests', testFiles: ['tests/test_core.py'],
    reportOnly: true
  };
  const payload = buildSessionReportJson({ findings: [finding] });
  const explained = buildExplainResult(finding, null, { nodes: [], edges: [] });
  for (const formatted of [payload.risk.findings[0], explained.finding]) {
    assert.equal(formatted.testEvidence, finding.testEvidence);
    assert.deepEqual(formatted.testFiles, finding.testFiles);
    assert.equal(formatted.reportOnly, true);
  }
});

function fixture(t, git = true, confirmed = false) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-explain-evidence-'));
  t.after(() => { stopWatcher(repo); fs.rmSync(repo, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(repo, 'services'));
  fs.mkdirSync(path.join(repo, 'routes'));
  fs.writeFileSync(path.join(repo, 'routes/api.py'), 'class Api:\n    pass\n');
  fs.writeFileSync(path.join(repo, 'services/worker.py'), 'class Worker:\n    pass\n');
  if (confirmed) {
    fs.mkdirSync(path.join(repo, '.av'));
    fs.writeFileSync(path.join(repo, '.av/layers.json'),
      JSON.stringify({ services: 'service', routes: 'controller' }));
  }
  if (git) {
    runGit(repo, 'init');
    runGit(repo, 'add', '.');
    runGit(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-m', 'baseline');
  } else {
    toolSessionStart({ repo });
  }
  fs.writeFileSync(path.join(repo, 'services/worker.py'),
    'from routes.api import Api\nclass Worker(Api):\n    pass\n');
  return repo;
}

function runGit(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function explain(repo) {
  return toolExplainFinding({ repo, from: 'session', rule: 'cross-layer-violation' });
}

function guard(repo) {
  const report = toolSessionGuard({ repo, editDir: repo, confirmRepo: repo });
  assert.ok(!report.error, JSON.stringify(report));
  return report;
}

for (const [git, confirmed] of [[true, false], [true, true], [false, false], [false, true]]) {
  it(`explains ${confirmed ? 'confirmed' : 'inferred'} edges with ${git ? 'HEAD only' : 'snapshot'} baseline`, t => {
    const repo = fixture(t, git, confirmed);
    const report = guard(repo);
    assert.ok(report.findings.some(f => f.rule === 'cross-layer-violation'), JSON.stringify(report.findings));
    if (git) assert.equal(fs.existsSync(path.join(repo, '.av/graph-baseline.json')), false);
    const result = explain(repo);
    assert.ok(!result.error, result.message);
    assert.equal(result.evidence.baselineKind, git ? 'git-head' : 'snapshot');
    assert.equal(result.edgeEvidence.from.file, 'services/worker.py');
    assert.equal(result.edgeEvidence.to.file, 'routes/api.py');
    assert.equal(result.evidence.source, 'session-report');
    assert.equal(result.finding.layerConfirmation, confirmed ? 'configured' : 'unconfirmed');
    assert.equal(result.finding.fromLayerSignal, confirmed ? 'config:.av/layers.json' : 'dir-name');
    assert.equal(result.finding.reportOnly === true, !confirmed);
    assert.equal(report.gateLevel, confirmed ? 'high' : 'none');
    assert.equal(report.exitCode, confirmed ? 1 : 0);
  });
}

it('does not mix a report with a later HEAD, changed worktree, or stale snapshot', t => {
  const repo = fixture(t);
  guard(repo);
  const before = explain(repo);
  assert.ok(before.edgeEvidence);
  fs.writeFileSync(path.join(repo, '.av/graph-baseline.json'), '{"fingerprint":"wrong","nodes":[]}');
  fs.writeFileSync(path.join(repo, 'services/worker.py'), 'class Renamed:\n    pass\n');
  runGit(repo, 'add', 'services/worker.py');
  runGit(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'later');
  fs.unlinkSync(path.join(repo, '.av/graph-head.json'));
  const after = explain(repo);
  assert.deepEqual(after, before);
  assert.notEqual(after.evidence.gitHead, runGit(repo, 'rev-parse', 'HEAD'));
  assert.match(after.evidence.note, /报告生成时/);
});

it('CLI report produces the same evidence required by MCP explain', t => {
  const repo = fixture(t);
  const result = spawnSync(process.execPath,
    [path.join(__dirname, '../bin/arch-viewer.js'), 'session', 'report', repo, '--renderer', 'builtin'],
    { encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '' } });
  assert.ok([0, 1].includes(result.status), result.stderr + result.stdout);
  assert.ok(explain(repo).edgeEvidence);
});

for (const mutation of ['legacy', 'mismatch', 'stale', 'invalid', 'invalid-node', 'invalid-edge', 'missing-severity', 'invalid-severity']) {
  it(`rejects ${mutation} report evidence without refreshing the baseline`, t => {
    const repo = fixture(t);
    guard(repo);
    const file = path.join(repo, '.av/session-report.json');
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (mutation === 'legacy') delete report.explanationContext;
    if (mutation === 'mismatch') report.explanationContext.baseFingerprint = 'wrong';
    if (mutation === 'stale') report.stale = true;
    if (mutation === 'invalid-node') report.explanationContext.nodes = [null];
    if (mutation === 'invalid-edge') report.diff.addedEdges = [null];
    if (mutation === 'missing-severity') delete report.findings[0].severity;
    if (mutation === 'invalid-severity') report.findings[0].severity = {};
    fs.writeFileSync(file, mutation === 'invalid' ? '{' : JSON.stringify(report));
    assert.equal(explain(repo).error, 'NO_SESSION_FINDING');
    assert.equal(fs.existsSync(path.join(repo, '.av/graph-baseline.json')), false);
  });
}
