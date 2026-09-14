'use strict';

// W15-02: Python + JS 各两个真实结构改动视觉验收
//
// Python：新增跨层 import、删除依赖、新增神文件
// JS：同结构改动 2 种（跨层 import、删除依赖）
// 断言：Delta 图边与 findings 端点一致，边/节点数量与顶栏一致

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk } = require('../lib/risk-rules');
const { buildReportData, generateReport } = require('../lib/session-report');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function pyLayered(dir) {
  writeTree(dir, {
    '.av/layers.json': JSON.stringify({ controllers: 'controller', services: 'service', models: 'storage' }),
    'controllers/api.py': 'class Api:\n    def handle(self, req):\n        return req\n',
    'services/svc.py': 'from models.db import DB\nclass Svc:\n    def run(self):\n        return DB().save(1)\n',
    'models/db.py': 'class DB:\n    def save(self, x):\n        return x\n'
  });
}

function jsLayered(dir) {
  writeTree(dir, {
    '.av/layers.json': JSON.stringify({ controllers: 'controller', services: 'service', models: 'storage' }),
    'controllers/api.js': 'function handle(req) { return req; }\nmodule.exports = { handle };\n',
    'services/svc.js': 'const { DB } = require("../models/db");\nclass Svc { run() { return new DB().save(1); } }\nmodule.exports = { Svc };\n',
    'models/db.js': 'class DB { save(x) { return x; } }\nmodule.exports = { DB };\n'
  });
}

function parseReportData(html) {
  const line = html.split('\n').find((l) => l.includes('const REPORT_DATA = {'));
  assert.ok(line, 'HTML 必须嵌入 REPORT_DATA');
  return JSON.parse(line.replace('const REPORT_DATA = ', '').replace(/;$/, ''));
}

function analyze(dir) {
  const start = run(['session', 'start', dir], dir);
  assert.equal(start.status, 0, start.stderr + start.stdout);
  const base = JSON.parse(fs.readFileSync(path.join(dir, '.av', 'graph-baseline.json'), 'utf8'));
  return base;
}

function reportAfter(dir) {
  const r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
  const html = fs.readFileSync(path.join(dir, '.av', 'session-report.html'), 'utf8');
  const rd = parseReportData(html);
  const json = JSON.parse(fs.readFileSync(path.join(dir, '.av', 'session-report.json'), 'utf8'));
  const head = buildGraph(dir);
  const base = JSON.parse(fs.readFileSync(path.join(dir, '.av', 'graph-baseline.json'), 'utf8'));
  const diff = diffGraphs(base, head);
  const findings = json.findings || [];
  return { cli: r, html, rd, json, diff, findings, head };
}

function assertDeltaMatchesFindings(rd, findings) {
  const graphEdges = rd.edges || [];
  const violFindings = findings.filter((f) =>
    /cross-layer|layer-skip|layering/i.test(f.rule || '')
  );
  for (const f of violFindings) {
    if (!f.from || !f.to) continue;
    const hit = graphEdges.find((e) => e.from === f.from && e.to === f.to);
    assert.ok(hit, `finding ${f.rule} ${f.from}→${f.to} 必须出现在 Delta 图边上`);
    assert.equal(hit.violation, true, `${f.from}→${f.to} 在图上应标 violation`);
  }
  const added = graphEdges.filter((e) => e.status === 'added').length;
  const removed = graphEdges.filter((e) => e.status === 'removed').length;
  assert.equal(rd.summary.addedArchitecturalEdges, added, '顶栏新增关系 = 图 added 边');
  assert.equal(rd.summary.removedArchitecturalEdges, removed, '顶栏删除关系 = 图 removed 边');
  assert.equal(rd.summary.violations, graphEdges.filter((e) => e.violation).length,
    '顶栏分层违规 = 图 violation 边');
}

describe('W15-02: Python 真实结构改动视觉验收', () => {
  it('新增跨层 import：Delta 图违规边与 findings 端点一致', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1502-py-xlayer-'));
    try {
      pyLayered(dir);
      analyze(dir);
      fs.writeFileSync(
        path.join(dir, 'models', 'db.py'),
        'from controllers.api import Api\nclass DB:\n    def save(self, x):\n        return Api().handle(x)\n'
      );
      const { cli, rd, findings } = reportAfter(dir);
      assert.equal(cli.status, 1, `跨层应为 HIGH exit 1，实际 ${cli.status}\n${cli.stdout}`);
      assert.ok(findings.some((f) => f.rule === 'cross-layer-violation' && f.severity === 'high'),
        `应有 HIGH 跨层 finding，实际: ${JSON.stringify(findings.map((f) => f.rule))}`);
      assertDeltaMatchesFindings(rd, findings);
      assert.ok(rd.edges.some((e) => e.violation && e.status === 'added'), '图上应有新增违规边');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('删除依赖：图上 removed 边数 = 顶栏删除关系，且对应原 import', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1502-py-rm-'));
    try {
      pyLayered(dir);
      analyze(dir);
      fs.writeFileSync(
        path.join(dir, 'services', 'svc.py'),
        'class Svc:\n    def run(self):\n        return 0\n'
      );
      const { cli, rd, diff } = reportAfter(dir);
      assert.equal(cli.status, 0, cli.stderr + cli.stdout);
      const removedImports = (rd.edges || []).filter((e) => e.status === 'removed' && e.type === 'import');
      assert.ok(removedImports.length >= 1, '应有至少 1 条 removed import 边');
      assert.equal(rd.summary.removedArchitecturalEdges, (rd.edges || []).filter((e) => e.status === 'removed').length);
      assert.ok(diff.removedEdges.some((e) => e.type === 'import'), 'JSON diff 应含删除的 import');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('新增神文件：finding 指向该文件，图上出现对应新增节点', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1502-py-god-'));
    try {
      pyLayered(dir);
      analyze(dir);
      const lines = ['# god file\n'];
      for (let i = 0; i < 820; i++) lines.push(`def f${i}():\n    return ${i}\n`);
      fs.writeFileSync(path.join(dir, 'helpers.py'), lines.join(''));
      const { rd, findings } = reportAfter(dir);
      const god = findings.find((f) => f.rule === 'god-file');
      assert.ok(god, `应有神文件 finding，实际: ${JSON.stringify(findings.map((f) => f.rule))}`);
      assert.match(god.file || god.detail || god.message, /helpers\.py/);
      const addedNodes = (rd.entities || []).filter((e) => e.status === 'added');
      assert.ok(addedNodes.length >= 1, '图上应有新增节点（神文件或其符号）');
      assert.equal(rd.summary.addedArchitecturalEdges, (rd.edges || []).filter((e) => e.status === 'added').length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('W15-02: JS 真实结构改动视觉验收', () => {
  it('新增跨层 import：Delta 图与 findings 一致', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1502-js-xlayer-'));
    try {
      jsLayered(dir);
      analyze(dir);
      fs.writeFileSync(
        path.join(dir, 'models', 'db.js'),
        'const { handle } = require("../controllers/api");\nclass DB { save(x) { return handle(x); } }\nmodule.exports = { DB };\n'
      );
      const { cli, rd, findings } = reportAfter(dir);
      assert.equal(cli.status, 1, `跨层应为 HIGH exit 1，实际 ${cli.status}\n${cli.stdout}`);
      assert.ok(findings.some((f) => f.rule === 'cross-layer-violation' && f.severity === 'high'));
      assertDeltaMatchesFindings(rd, findings);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('删除依赖：图 removed 边与 JSON removedEdges 对齐', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1502-js-rm-'));
    try {
      jsLayered(dir);
      analyze(dir);
      fs.writeFileSync(
        path.join(dir, 'services', 'svc.js'),
        'class Svc { run() { return 0; } }\nmodule.exports = { Svc };\n'
      );
      const { rd, diff } = reportAfter(dir);
      const removed = (rd.edges || []).filter((e) => e.status === 'removed');
      assert.ok(removed.length >= 1, '应有 deleted 依赖边');
      assert.equal(rd.summary.removedArchitecturalEdges, removed.length);
      assert.ok(diff.removedEdges.filter((e) => e.type === 'import').length >= 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('W15-02: generateReport 与 CLI HTML 同源', () => {
  it('库内 buildReportData 与落盘 HTML REPORT_DATA 边数一致', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1502-same-'));
    try {
      jsLayered(dir);
      const base = buildGraph(dir);
      fs.writeFileSync(
        path.join(dir, 'models', 'db.js'),
        'const { handle } = require("../controllers/api");\nclass DB { save(x) { return handle(x); } }\nmodule.exports = { DB };\n'
      );
      const head = buildGraph(dir);
      const diff = diffGraphs(base, head);
      const findings = evaluateRisk(diff, head, base);
      const payload = buildReportData(base, head, diff, findings, null, 'visual', null);
      const html = generateReport({ baseGraph: base, headGraph: head, diff, findings, impact: null, repoName: 'visual' });
      const rd = parseReportData(html);
      assert.equal(rd.edges.length, payload.edges.length);
      assert.equal(rd.summary.addedArchitecturalEdges, payload.summary.addedArchitecturalEdges);
      assert.equal(rd.risk.findings.length, findings.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
