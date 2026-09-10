'use strict';

/**
 * Session report with builtin-only analyzers (external CLI adapters removed).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings } = require('../lib/risk-rules');
const { runAnalyzers } = require('../lib/analyzers');
const { toolSessionStart, toolSessionReport, stopWatcher } = require('../mcp/server');
const { reportRepo } = require('../lib/workspace');
const { generateReport, buildSessionReportJson } = require('../lib/session-report');

function write(repo, name, content) {
  const filename = path.join(repo, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
}

function makeRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-analyzer-session-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  write(repo, 'src/a.js', 'module.exports = 1;\n');
  write(repo, 'src/b.js', 'module.exports = 2;\n');
  const baseline = buildGraph(repo);
  write(repo, '.av/graph-baseline.json', JSON.stringify(baseline));
  write(repo, 'src/a.js', "module.exports = require('./b');\n");
  const current = buildGraph(repo);
  return { repo, baseline, current, diff: diffGraphs(baseline, current) };
}

function htmlPayload(filename) {
  const html = fs.readFileSync(filename, 'utf8');
  const match = html.match(/const REPORT_DATA = (.+);/);
  assert.ok(match, 'HTML embeds the report payload');
  return JSON.parse(match[1]);
}

test('CLI, MCP, workspace, JSON and HTML share builtin risk and analyzerStatus', t => {
  const { repo } = makeRepo(t);
  const cli = spawnSync(process.execPath, [path.join(__dirname, '../bin/arch-viewer.js'), 'session', 'report', repo], {
    encoding: 'utf8', timeout: 30000
  });
  assert.ok([0, 1].includes(cli.status), cli.stdout + cli.stderr);
  const json = JSON.parse(fs.readFileSync(path.join(repo, '.av/session-report.json'), 'utf8'));
  const html = htmlPayload(path.join(repo, '.av/session-report.builtin.html'));
  assert.deepEqual(html.risk, json.risk);
  assert.deepEqual(html.analyzerStatus, json.analyzerStatus);
  assert.equal(json.analyzerStatus.length, 1);
  assert.equal(json.analyzerStatus[0].id, 'builtin');
  const mcp = toolSessionReport({ repo });
  assert.equal(mcp.riskLevel, json.risk.level);
  assert.deepEqual(mcp.analyzerStatus, json.analyzerStatus);
  const workspace = reportRepo({ name: 'sample', path: repo });
  assert.equal(workspace.status, 'ok');
  assert.deepEqual(workspace.findings, json.findings);
});

test('empty session diff produces no contract/external noise', t => {
  const { repo, current } = makeRepo(t);
  const { merged, sources } = runAnalyzers(repo, {
    baseline: current,
    current,
    diff: diffGraphs(current, current)
  });
  assert.equal(merged.violations.length, 0);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 'builtin');
});

test('built-in wrapper reuses supplied snapshot and preserves finding details and rules', t => {
  const { repo, baseline, current, diff } = makeRepo(t);
  fs.rmSync(path.join(repo, 'src'), { recursive: true });
  const rules = { forbid: [{ from: 'util', to: 'util' }] };
  const { merged } = runAnalyzers(repo, { baseline, current, diff, rules });
  assert.equal(merged.nodes.length, current.nodes.length);
  assert.deepEqual(
    merged.violations.map(({ sourceAnalyzer, confidence, ...f }) => f),
    evaluateRisk(diff, current, baseline, null, { rules })
  );
});

test('high diagnostic outranks low findings in serialized views', t => {
  const { repo, baseline, current } = makeRepo(t);
  const findings = [
    { rule: 'external', severity: 'high', title: 'External', message: '<img src=x>', sourceAnalyzer: 'builtin', confidence: 'high' },
    { rule: 'note', severity: 'low', title: 'Note', message: 'note' }
  ];
  const options = {
    baseGraph: baseline,
    headGraph: current,
    diff: diffGraphs(baseline, current),
    findings,
    repoName: repo,
    riskSummary: summarizeFindings(findings)
  };
  const report = buildSessionReportJson(options);
  assert.equal(report.risk.level, 'high');
  assert.equal(report.risk.findings[0].sourceAnalyzer, 'builtin');
  const html = generateReport(options);
  assert.match(html, /escText\(f.message\)/);
  const formatDelta = html.match(/function formatDeltaCount\([\s\S]*?\n\}/)[0];
  const labels = vm.runInNewContext(formatDelta + `\n[
    formatDeltaCount([], [{ status: 'added', violation: true }]),
    formatDeltaCount([], [{ status: 'unchanged', violation: true }]),
    formatDeltaCount([], [])
  ]`);
  assert.match(labels[0], /1 条关系变更/);
  assert.match(labels[1], /违规依赖/);
  assert.equal(labels[2], '未检测到架构结构变化');
});

test('CLI suggest-config is removed (exit 2)', t => {
  const { repo } = makeRepo(t);
  const cli = spawnSync(
    process.execPath,
    [path.join(__dirname, '../bin/arch-viewer.js'), 'session', 'suggest-config', repo, '--analyzer', 'dependency-cruiser'],
    { encoding: 'utf8' }
  );
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /suggest-config 已移除/);
});

test('MCP report analyzerStatus is builtin-only', t => {
  const { repo } = makeRepo(t);
  write(repo, 'src/a.js', 'module.exports = 1;\n');
  toolSessionStart({ repo });
  t.after(() => stopWatcher(repo));
  write(repo, 'src/a.js', "const b = require('./b'); module.exports = b;\n");
  const report = toolSessionReport({ repo });
  assert.ok(report.analyzerStatus.every((s) => s.id === 'builtin'));
  assert.ok(report.findings.every((f) => !f.sourceAnalyzer || f.sourceAnalyzer === 'builtin'));
});
