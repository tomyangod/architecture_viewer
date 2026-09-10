'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings } = require('../lib/risk-rules');
const { describeGreenLight } = require('../lib/green-light');
const { buildReportData } = require('../lib/session-report');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function tmpRepo(prefix, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

describe('impl-surface: 函数体业务实现差异', () => {
  it('只改日志字符串：结构 0 变化，标 literals，info 不阻断', () => {
    const dir = tmpRepo('av-impl-log-', {
      'src/app.js': 'class App {\n  run() { console.log("old"); return 1; }\n}\nmodule.exports = { App };\n'
    });
    try {
      const base = buildGraph(dir);
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'class App {\n  run() { console.log("new"); return 1; }\n}\nmodule.exports = { App };\n');
      const head = buildGraph(dir);
      assert.equal(base.fingerprint, head.fingerprint, '结构指纹不应变');
      assert.notEqual(base.contentFingerprint, head.contentFingerprint, '源码指纹应变');

      const diff = diffGraphs(base, head);
      assert.equal(diff.summary.totalChanges, 0);
      assert.equal(diff.summary.implChangedCount, 1);
      assert.equal(diff.implChanges[0].change, 'literals');
      assert.ok(diff.implChanges[0].addedLiterals.includes('new'));
      assert.ok(diff.implChanges[0].removedLiterals.includes('old'));
      assert.equal(diff.implChanges[0].owner, 'App');
      assert.equal(diff.implChanges[0].method, 'run');

      const findings = evaluateRisk(diff, head, base);
      const impl = findings.filter((f) => f.rule === 'impl-changed');
      assert.equal(impl.length, 1);
      assert.equal(impl[0].severity, 'info');
      assert.equal(summarizeFindings(findings).level, 'none');

      const data = buildReportData(base, head, diff, findings, null, 'demo', null);
      assert.equal(data.risk.level, 'none');
      assert.equal(data.implementation.count, 1);
      assert.equal(data.implementation.changes[0].change, 'literals');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('只改注释：实现差异为 0，仍报源码内容变化', () => {
    const dir = tmpRepo('av-impl-cmt-', {
      'src/app.js': 'class App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n'
    });
    try {
      const base = buildGraph(dir);
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        '// only comment\nclass App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n');
      const head = buildGraph(dir);
      const diff = diffGraphs(base, head);
      assert.equal(diff.summary.totalChanges, 0);
      assert.equal(diff.summary.implChangedCount, 0);
      assert.equal(diff.summary.sourceChanged, true);
      assert.equal(evaluateRisk(diff, head, base).filter((f) => f.rule === 'impl-changed').length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('增加 if：标 control-flow', () => {
    const dir = tmpRepo('av-impl-if-', {
      'src/app.js': 'function go(x) { return x; }\nmodule.exports = { go };\n'
    });
    try {
      const base = buildGraph(dir);
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'function go(x) { if (x) { return x; } return x; }\nmodule.exports = { go };\n');
      const head = buildGraph(dir);
      const diff = diffGraphs(base, head);
      assert.equal(diff.summary.totalChanges, 0);
      assert.ok(diff.implChanges.length >= 1);
      assert.equal(diff.implChanges[0].change, 'control-flow');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Python from 函数只改字符串：literals，结构不变', () => {
    const dir = tmpRepo('av-impl-py-', {
      'app/svc.py': 'def greet():\n    print("hi")\n    return 1\n'
    });
    try {
      const base = buildGraph(dir);
      fs.writeFileSync(path.join(dir, 'app', 'svc.py'),
        'def greet():\n    print("hello")\n    return 1\n');
      const head = buildGraph(dir);
      assert.equal(base.fingerprint, head.fingerprint);
      const diff = diffGraphs(base, head);
      assert.equal(diff.summary.totalChanges, 0);
      assert.ok(diff.implChanges.some((c) => c.change === 'literals' && c.method === 'greet'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('旧基线没有 impl 字段 → 不误报', () => {
    const dir = tmpRepo('av-impl-old-', {
      'src/app.js': 'class App {\n  run() { console.log("x"); }\n}\nmodule.exports = { App };\n'
    });
    try {
      const head = buildGraph(dir);
      const base = JSON.parse(JSON.stringify(head));
      for (const n of base.nodes) {
        delete n.impl;
        delete n.methodImpls;
      }
      const diff = diffGraphs(base, head);
      assert.equal(diff.summary.implChangedCount, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI：改日志字符串列出实现差异且退出 0', () => {
    const dir = tmpRepo('av-impl-cli-', {
      'src/app.js': 'class App {\n  run() { console.log("old"); return 1; }\n}\nmodule.exports = { App };\n'
    });
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'class App {\n  run() { console.log("new"); return 1; }\n}\nmodule.exports = { App };\n');
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /实现差异/);
      assert.match(r.stdout, /文案\/常量|业务实现有变化/);
      assert.match(r.stdout, /未检测到架构结构变化/);
      assert.ok(!/⛔/.test(r.stdout), r.stdout);

      const html = fs.readFileSync(path.join(dir, '.av', 'session-report.html'), 'utf8');
      assert.match(html, /实现差异/);
      assert.match(html, /未判定业务对错/);
      const json = JSON.parse(fs.readFileSync(path.join(dir, '.av', 'session-report.json'), 'utf8'));
      assert.equal(json.implementation.count, 1);
      assert.equal(json.risk.level, 'none');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('绿灯文案：implChangedCount 优先于笼统的 source-only', () => {
    const copy = describeGreenLight({ totalChanges: 0, sourceChanged: true, implChangedCount: 2 });
    assert.equal(copy.kind, 'impl-only');
    assert.match(copy.cli, /2 个函数体实现差异/);
    assert.match(copy.cli, /未判定业务对错/);
  });
});
