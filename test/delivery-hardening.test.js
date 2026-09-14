'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assessAnalysisCompleteness, applyCompletenessToRisk } = require('../lib/analysis-completeness');
const { buildGraph } = require('../lib/extract-graph');
const { walkSourceFiles, DEV_SKIP_DIRS } = require('../lib/extract/shared');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('analysis completeness (gate1 honesty)', () => {
  it('completeness summaries include the finding exactly once across repeated application', () => {
    const { summarizeFindings } = require('../lib/risk-rules');
    const completeness = assessAnalysisCompleteness({
      stats: { files: 2, filesParsed: 1, parseErrors: 1 }
    });
    const findings = [{ rule: 'orphan-entity', severity: 'low' }];
    const once = applyCompletenessToRisk(findings, summarizeFindings(findings), completeness);
    const twice = applyCompletenessToRisk(once.findings, once.riskSummary, completeness);
    assert.deepEqual(twice, once);
    assert.equal(once.riskSummary.total, 2);
    assert.equal(once.riskSummary.counts.medium, 1);
    assert.equal(once.riskSummary.level, 'medium');
  });

  it('parse-all-failed must not allow green', () => {
    const c = assessAnalysisCompleteness({
      stats: { files: 2, filesParsed: 0, parseErrors: 2 }
    });
    assert.equal(c.status, 'failed');
    assert.equal(c.allowGreen, false);
    assert.match(c.message, /分析失败|不能视为|没有串门/);
    const applied = applyCompletenessToRisk([], { level: 'none', counts: { high: 0, medium: 0, low: 0 } }, c);
    assert.equal(applied.riskSummary.level, 'high');
    assert.equal(applied.findings[0].rule, 'analysis-failed');
  });

  it('empty scan must not allow green', () => {
    const c = assessAnalysisCompleteness({ stats: { files: 0, filesParsed: 0, parseErrors: 0 } });
    assert.equal(c.status, 'failed');
    assert.equal(c.allowGreen, false);
  });

  it('toolCheckLayering does not claim 没有串门 when parsers missing', () => {
    const { spawnSync } = require('child_process');
    const serverPath = path.join(__dirname, '../mcp/server.js');
    const script = `
      const Module = require('module');
      const orig = Module._load;
      Module._load = function (id, parent, isMain) {
        if (id === 'tree-sitter' || String(id).startsWith('tree-sitter-')) {
          const e = new Error('simulated parser unavailable');
          e.code = 'MODULE_NOT_FOUND';
          throw e;
        }
        return orig.apply(this, arguments);
      };
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-honesty-live-'));
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'a.py'), 'class A:\\n    pass\\n');
      fs.writeFileSync(path.join(dir, 'src', 'b.py'), 'class B:\\n    pass\\n');
      const { toolCheckLayering } = require(${JSON.stringify(serverPath)});
      const r = toolCheckLayering({ repo: dir });
      fs.rmSync(dir, { recursive: true, force: true });
      process.stdout.write(JSON.stringify({
        allow: r.analysisAllowGreen,
        status: r.analysisStatus,
        level: r.riskLevel,
        message: r.message,
        stats: r.stats
      }));
    `;
    const out = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr || out.stdout);
    const r = JSON.parse(out.stdout);
    assert.equal(r.allow, false);
    assert.equal(r.status, 'failed');
    assert.notEqual(r.level, 'none');
    assert.doesNotMatch(r.message || '', /✅\\s*没有串门/);
    assert.match(r.message || '', /分析失败|不完整|不能/);
  });
});

describe('scan example package (gate2 leak)', () => {
  it('does not skip com/example Java package dirs', () => {
    assert.equal(DEV_SKIP_DIRS.has('example'), false);
    const dir = tmpDir('av-java-example-');
    const pkg = path.join(dir, 'src', 'main', 'java', 'com', 'example', 'service');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'OrderService.java'), 'package com.example.service;\npublic class OrderService {}\n');
    const byLang = walkSourceFiles(dir);
    const java = byLang.get('java') || [];
    assert.ok(java.some((p) => p.includes(`${path.sep}example${path.sep}`)), 'expected com/example sources to be scanned');
    const g = buildGraph(dir);
    assert.ok(g.stats.files >= 1, 'graph should include java file');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('still skips top-level examples/ directory', () => {
    const dir = tmpDir('av-examples-top-');
    fs.mkdirSync(path.join(dir, 'examples'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'examples', 'demo.py'), 'class Demo:\n    pass\n');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.py'), 'class App:\n    pass\n');
    const byLang = walkSourceFiles(dir);
    const py = byLang.get('python') || [];
    assert.ok(py.some((p) => p.endsWith(`src${path.sep}app.py`)));
    assert.ok(!py.some((p) => p.includes(`${path.sep}examples${path.sep}`)));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('python import alias (gate2 facts)', () => {
  it('import pandas as pd keeps specifier pandas', () => {
    const dir = tmpDir('av-py-alias-');
    fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pkg', 'a.py'), 'import pandas as pd\n');
    const g = buildGraph(dir);
    const ext = g.nodes.find((n) => n.kind === 'external' && n.name === 'pandas');
    assert.ok(ext, 'external node should be pandas');
    assert.ok(!g.nodes.some((n) => n.name === 'pandasaspd'), 'must not glue alias into specifier');
    const bad = g.edges.find((e) => e.to === 'ext:pandasaspd');
    assert.equal(bad, undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('incomplete floors existing LOW findings to medium', () => {
    const c = assessAnalysisCompleteness({
      stats: { files: 2, filesParsed: 1, parseErrors: 1 }
    });
    assert.equal(c.status, 'incomplete');
    const applied = applyCompletenessToRisk(
      [{ rule: 'orphan-entity', severity: 'low', title: 'x' }],
      { level: 'low', counts: { high: 0, medium: 0, low: 1 }, gateLevel: 'low' },
      c
    );
    assert.equal(applied.riskSummary.level, 'medium');
    assert.equal(applied.riskSummary.gateLevel, 'medium');
    const { exitCodeForAnalysis, EXIT } = require('../lib/exit-codes');
    assert.equal(exitCodeForAnalysis(c, applied.riskSummary.level, 'high'), EXIT.SCAN_FAILED);
  });

  it('unreadable directory marks analysis incomplete', () => {
    const dir = tmpDir('av-unread-');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'ok.py'), 'class Ok:\n    pass\n');
    const locked = path.join(dir, 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'secret.py'), 'class Secret:\n    pass\n');
    const readdirSync = fs.readdirSync;
    fs.readdirSync = function (dirPath, ...args) {
      if (dirPath === locked) {
        const error = new Error('simulated permission denied');
        error.code = 'EACCES';
        throw error;
      }
      return readdirSync.call(this, dirPath, ...args);
    };
    try {
      const byLang = walkSourceFiles(dir);
      assert.deepEqual(byLang.meta.unreadableDirs, ['locked']);
      const g = buildGraph(dir);
      const c = assessAnalysisCompleteness(g);
      assert.equal(c.status, 'incomplete');
      assert.equal(c.allowGreen, false);
    } finally {
      fs.readdirSync = readdirSync;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not bind unrelated unique Event by name alone', () => {
    const dir = tmpDir('av-py-event-');
    fs.mkdirSync(path.join(dir, 'domain'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'domain', 'event.py'), 'class Event:\n    pass\n');
    fs.writeFileSync(
      path.join(dir, 'app', 'handler.py'),
      'class Handler:\n    def on(self, ev: Event) -> None:\n        pass\n'
    );
    const g = buildGraph(dir);
    const bad = g.edges.find(
      (e) => e.from === 'app/handler#Handler' && e.to === 'domain/event#Event' && e.type === 'method-param'
    );
    assert.equal(bad, undefined, 'bare Event annotation must not link to unique local Event without import');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('from import Order as Ord keeps true edge to Order (not dangling #Ord)', () => {
    const dir = tmpDir('av-py-ord-');
    fs.mkdirSync(path.join(dir, 'domain'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'domain', 'order.py'), 'class Order:\n    pass\n');
    fs.writeFileSync(
      path.join(dir, 'app', 'service.py'),
      'from domain.order import Order as Ord\nclass Service:\n    def handle(self, o: Ord) -> Ord:\n        return o\n'
    );
    const g = buildGraph(dir);
    const ids = new Set(g.nodes.map((n) => n.id));
    const param = g.edges.find((e) => e.type === 'method-param' && e.from === 'app/service#Service');
    assert.ok(param, 'true method-param edge must exist');
    assert.equal(param.to, 'domain/order#Order');
    assert.equal(ids.has(param.to), true);
    assert.equal(ids.has('domain/order#Ord'), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('JS import { Order as Ord } keeps extends to Order', () => {
    const dir = tmpDir('av-js-ord-');
    fs.mkdirSync(path.join(dir, 'domain'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'domain', 'order.ts'), 'export class Order {}\n');
    fs.writeFileSync(
      path.join(dir, 'app', 'service.ts'),
      "import { Order as Ord } from '../domain/order';\nexport class Service extends Ord {}\n"
    );
    const g = buildGraph(dir);
    const ext = g.edges.find((e) => e.type === 'extends' && e.from === 'app/service#Service');
    assert.ok(ext, 'true extends edge must exist');
    assert.equal(ext.to, 'domain/order#Order');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('unreadableDirs in stats forbids green', () => {
    const c = assessAnalysisCompleteness({
      stats: { files: 1, filesParsed: 1, parseErrors: 0, unreadableDirs: ['locked'] }
    });
    assert.equal(c.status, 'incomplete');
    assert.equal(c.allowGreen, false);
  });

  it('session JSON carries analysis.status', () => {
    const { buildSessionReportJson } = require('../lib/session-report');
    const completeness = assessAnalysisCompleteness({
      stats: { files: 2, filesParsed: 1, parseErrors: 1 }
    });
    const emptyGraph = { nodes: [], edges: [], fingerprint: 'a', stats: { files: 2, filesParsed: 1, parseErrors: 1 } };
    const disk = buildSessionReportJson({
      diff: { summary: { totalChanges: 0 }, base: { fingerprint: 'a' }, head: { fingerprint: 'b' } },
      findings: [completeness.finding],
      riskSummary: { level: 'medium', counts: { medium: 1 } },
      impact: null,
      analyzerStatus: [],
      baseGraph: emptyGraph,
      headGraph: { ...emptyGraph, fingerprint: 'b' },
      repoName: 'x',
      analysisCompleteness: completeness
    });
    assert.equal(disk.analysis.status, 'incomplete');
    assert.equal(disk.analysis.allowGreen, false);
  });
});
