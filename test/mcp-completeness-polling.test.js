'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildGraph } = require('../lib/extract-graph');
const {
  toolSessionChanges, generateSessionReport, startWatcher, stopWatcher
} = require('../mcp/server');

it('polling preserves incomplete analysis when structural output is unchanged', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-poll-incomplete-'));
  const watch = fs.watch;
  try {
    fs.writeFileSync(path.join(repo, 'app.py'), 'class App:\n    pass\n');
    fs.writeFileSync(path.join(repo, 'oversized.py'), '# comment\n'.repeat(60000));
    fs.mkdirSync(path.join(repo, '.av'));
    fs.writeFileSync(path.join(repo, '.av', 'graph-baseline.json'),
      JSON.stringify({ ...buildGraph(repo), sessionStartedAt: new Date().toISOString() }));

    function assertIncomplete(result) {
      assert.equal(result.hasChanges, false);
      assert.equal(result.analysisStatus, 'incomplete');
      assert.equal(result.analysisAllowGreen, false);
      assert.equal(result.analysis.status, 'incomplete');
      assert.ok(result.analysis.reasons.length);
      assert.equal(result.exitCode, 3);
      assert.match(result.message, /分析不完整/);
      assert.doesNotMatch(result.message, /未检测到架构结构变化|结构验收通过/);
      assert.match(result.nextStep, /修复/);
    }

    assertIncomplete(toolSessionChanges({ repo }));
    const report = generateSessionReport(repo);
    fs.watch = () => ({ close() {}, unref() {} });
    const state = startWatcher(repo);
    state.autoReport = report;
    assertIncomplete(toolSessionChanges({ repo }));
    state.autoReport = null;
    assertIncomplete(toolSessionChanges({ repo }));
  } finally {
    fs.watch = watch;
    stopWatcher(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
