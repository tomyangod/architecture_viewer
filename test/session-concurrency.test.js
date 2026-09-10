'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { runAnalyzers } = require('../lib/analyzers');
const { buildSessionReportJson } = require('../lib/session-report');
const { summarizeFindings } = require('../lib/risk-rules');

function writeRepo(name, src) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), name));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), src);
  return repo;
}

test('two session reports stay isolated', () => {
  const a = writeRepo('av-conc-a-', 'module.exports = 1;\n');
  const b = writeRepo('av-conc-b-', 'module.exports = 2;\n');
  try {
    const baseA = buildGraph(a);
    const baseB = buildGraph(b);
    fs.writeFileSync(path.join(a, 'src', 'a.js'), 'module.exports = "alpha-unique";\n');
    fs.writeFileSync(path.join(b, 'src', 'extra.js'), 'module.exports = "beta-unique";\n');
    const curA = buildGraph(a);
    const curB = buildGraph(b);
    const diffA = diffGraphs(baseA, curA);
    const diffB = diffGraphs(baseB, curB);
    const runA = runAnalyzers(a, { baseline: baseA, current: curA, diff: diffA });
    const runB = runAnalyzers(b, { baseline: baseB, current: curB, diff: diffB });
    const jsonA = buildSessionReportJson({
      diff: diffA, findings: runA.merged.violations, riskSummary: summarizeFindings(runA.merged.violations),
      baseGraph: baseA, headGraph: curA, repoName: 'a'
    });
    const jsonB = buildSessionReportJson({
      diff: diffB, findings: runB.merged.violations, riskSummary: summarizeFindings(runB.merged.violations),
      baseGraph: baseB, headGraph: curB, repoName: 'b'
    });
    assert.equal(jsonA.repo, 'a');
    assert.equal(jsonB.repo, 'b');
    assert.ok(runA.merged.nodes.some((n) => n.path === 'src/a.js'));
    assert.ok(runB.merged.nodes.some((n) => n.path === 'src/extra.js'));
    assert.ok(!runA.merged.nodes.some((n) => n.path === 'src/extra.js'));
    assert.ok(jsonA.risk.findings.every((f) => !String(f.file || '').includes(b)));
    assert.ok(jsonB.risk.findings.every((f) => !String(f.file || '').includes(a)));
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
