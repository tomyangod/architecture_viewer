'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  toolSessionGuard, toolExplainFinding, buildExplainResult, stopWatcher
} = require('../mcp/server');
const { formatSessionVerdict } = require('../lib/session-verdict');

function runGit(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function cycleFixture(t, opts = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-cycle-explain-'));
  t.after(() => { stopWatcher(repo); fs.rmSync(repo, { recursive: true, force: true }); });
  // Two same-named files in different dirs: cycle chains must stay unambiguous.
  fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'crawler'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tools/launcher.py'), 'class Launcher:\n    pass\n');
  fs.writeFileSync(path.join(repo, 'crawler/launcher.py'), 'class Impl:\n    pass\n');
  runGit(repo, 'init');
  runGit(repo, 'add', '.');
  runGit(repo, '-c', 'user.name=T', '-c', 'user.email=t@t.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'base');
  // This round: close a 2-node import cycle between the two same-named files.
  fs.writeFileSync(path.join(repo, 'tools/launcher.py'),
    'from crawler.launcher import Impl\nclass Launcher:\n    pass\n');
  fs.writeFileSync(path.join(repo, 'crawler/launcher.py'),
    'from tools.launcher import Launcher\nclass Impl:\n    pass\n');
  const report = toolSessionGuard({ repo, editDir: repo, confirmRepo: repo });
  assert.ok(!report.error, JSON.stringify(report).slice(0, 400));
  return { repo, report };
}

describe('circular-import explain evidence', () => {
  it('guards a new cycle with structured ring data and full-path chain', (t) => {
    const { report } = cycleFixture(t);
    const finding = report.findings.find((f) => f.rule === 'circular-import');
    assert.ok(finding, JSON.stringify(report.findings));
    // Full repo-relative paths, not basenames (two launcher.py must not blur).
    assert.match(finding.detail, /tools\/launcher\.py/);
    assert.match(finding.detail, /crawler\/launcher\.py/);
    assert.ok(Array.isArray(finding.cycleEdges) && finding.cycleEdges.length >= 2);
    assert.ok(finding.cycleEdges.some((e) => e.isNew));
    assert.ok(finding.newEdge && finding.newEdge.from && finding.newEdge.to);
  });

  it('explains the cycle from the session report with cycleEvidence', (t) => {
    const { repo } = cycleFixture(t);
    const result = toolExplainFinding({ repo, from: 'session', rule: 'circular-import' });
    assert.ok(!result.error, result.message);
    assert.ok(result.cycleEvidence, JSON.stringify(result));
    assert.equal(result.cycleEvidence.edges.length >= 2, true);
    const newEdges = result.cycleEvidence.edges.filter((e) => e.isNew);
    assert.equal(newEdges.length >= 1, true);
    // Suggestion names the concrete new edge, not generic advice.
    assert.match(result.suggestion, /launcher\.py/);
    assert.match(result.suggestion, /闭合了这个环/);
  });
});

describe('broad-impact explain evidence', () => {
  it('returns seed and downstream sample from stored impact', () => {
    const target = {
      rule: 'broad-impact', severity: 'high', title: '广泛影响',
      message: '"hub" 变更波及 25 个下游（直接 20 + 间接 5）',
      detail: 'file:lib/hub.js', impactDownstream: 25
    };
    const impact = {
      changedCount: 1, impactedCount: 25,
      items: [{
        id: 'file:lib/hub.js', change: 'modified', label: '修改',
        node: { id: 'file:lib/hub.js', name: 'hub', kind: 'file', path: 'lib/hub.js', layer: 'util' },
        direct: Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `dep${i}`, path: `lib/dep${i}.js` })),
        transitive: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, name: `far${i}`, path: `lib/far${i}.js` }))
      }]
    };
    const result = buildExplainResult(target, null, { nodes: [], edges: [] }, impact);
    assert.ok(result.impactEvidence, JSON.stringify(result));
    assert.equal(result.impactEvidence.seed.file, 'lib/hub.js');
    assert.equal(result.impactEvidence.directCount, 20);
    assert.equal(result.impactEvidence.transitiveCount, 5);
    assert.equal(result.impactEvidence.directSample.length, 10);
    // Suggestion frames it as a review reminder, not a proven defect.
    assert.match(result.suggestion, /影响面提醒/);
    assert.match(result.suggestion, /25/);
  });
});

describe('verdict baseline wording', () => {
  it('states snapshot baseline explicitly instead of implying HEAD', () => {
    const v = formatSessionVerdict({
      riskSummary: { level: 'none', counts: {} },
      summary: { totalChanges: 0 },
      baselineKind: 'snapshot'
    });
    assert.match(v.text, /对照会话快照（非 git HEAD）/);
    assert.doesNotMatch(v.text, /对照 git HEAD(?!）)/);
  });

  it('keeps git-head wording for HEAD baselines', () => {
    const v = formatSessionVerdict({
      riskSummary: { level: 'none', counts: {} },
      summary: { totalChanges: 0 },
      baselineKind: 'git-head'
    });
    assert.match(v.text, /对照 git HEAD/);
    assert.doesNotMatch(v.text, /对照会话快照/);
  });
});
