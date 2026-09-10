'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  formatSessionVerdict,
  nextStepForVerdict,
  pickTopFinding,
  normalizeReportPath
} = require('../lib/session-verdict');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

describe('formatSessionVerdict', () => {
  it('绿灯 ≤3 行，含可选详情链接，不强迫打开 HTML', () => {
    const v = formatSessionVerdict({
      riskSummary: { level: 'none', counts: { high: 0, medium: 0, low: 0 } },
      findings: [],
      summary: { totalChanges: 0, sourceChanged: false },
      reportPath: '/tmp/demo/.av/session-report.html'
    });
    assert.equal(v.level, 'none');
    assert.ok(v.lines.length <= 3);
    assert.match(v.lines[0], /🟢/);
    assert.match(v.lines[0], /结构验收通过/);
    assert.match(v.lines[0], /0 项风险/);
    assert.match(v.text, /详情（可选）：\.av\/session-report\.html/);
    assert.ok(!/必须打开|请打开 HTML|Open the HTML/i.test(v.text));
  });

  it('有结构变更无风险时第 1 行列出变更数', () => {
    const v = formatSessionVerdict({
      riskSummary: { level: 'none', counts: {} },
      findings: [],
      summary: { totalChanges: 2, sourceChanged: true }
    });
    assert.match(v.lines[0], /2 项结构变更/);
    assert.match(v.lines[1], /无风险发现|架构变更/);
  });

  it('红灯必须含最严重 finding 的文件与规则', () => {
    const v = formatSessionVerdict({
      riskSummary: { level: 'high', counts: { high: 2, medium: 1, low: 0 } },
      findings: [
        {
          severity: 'medium',
          rule: 'god-file',
          title: '文件过大',
          file: 'src/big.js'
        },
        {
          severity: 'high',
          rule: 'layer-skip',
          title: '跨层串门',
          file: 'src/routes/todos.js',
          line: 12
        }
      ],
      summary: { totalChanges: 3 }
    });
    assert.equal(v.level, 'high');
    assert.match(v.lines[0], /🔴/);
    assert.match(v.lines[0], /HIGH 2/);
    assert.match(v.lines[1], /最严重：/);
    assert.match(v.lines[1], /layer-skip|跨层串门/);
    assert.match(v.lines[1], /src\/routes\/todos\.js:12/);
    assert.equal(v.topFinding.rule, 'layer-skip');
  });

  it('黄灯选中 severity=medium 的 top finding', () => {
    const v = formatSessionVerdict({
      riskSummary: { level: 'medium', counts: { high: 0, medium: 1, low: 1 } },
      findings: [
        { severity: 'low', rule: 'orphan', title: '孤立', file: 'a.js' },
        { severity: 'medium', rule: 'broad-impact', title: '影响面大', file: 'b.js' }
      ],
      summary: { totalChanges: 1 }
    });
    assert.match(v.lines[0], /🟠/);
    assert.match(v.lines[1], /b\.js/);
    assert.equal(v.topFinding.rule, 'broad-impact');
  });

  it('git-head 基线在详情行标明对照点与未提交', () => {
    const v = formatSessionVerdict({
      riskSummary: { level: 'none', counts: {} },
      findings: [],
      summary: { totalChanges: 0, sourceChanged: true },
      baselineKind: 'git-head',
      hasUncommitted: true
    });
    assert.match(v.lines[v.lines.length - 1], /对照 git HEAD/);
    assert.match(v.lines[v.lines.length - 1], /含未提交改动/);
  });

  it('normalizeReportPath 收敛为相对 .av/…', () => {
    assert.equal(
      normalizeReportPath('/Users/x/proj/.av/session-report.html'),
      '.av/session-report.html'
    );
    assert.equal(normalizeReportPath(null), '.av/session-report.html');
  });

  it('nextStep 不要求必须打开 HTML，但仍可提刷新基线', () => {
    const high = nextStepForVerdict({ level: 'high' });
    assert.match(high, /av_explain_finding|修/);
    assert.match(high, /可选|需要图/);
    assert.ok(!/必须打开/.test(high));
    const green = nextStepForVerdict({ level: 'none' });
    assert.match(green, /av_session_start/);
    const gitGreen = nextStepForVerdict({ level: 'none' }, { baselineKind: 'git-head' });
    assert.match(gitGreen, /commit 即接受/);
    assert.ok(!/av_session_start/.test(gitGreen));
  });
});

describe('CLI session report 打印 verdict', () => {
  it('绿灯输出含结构验收通过与详情（可选）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-verdict-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'class App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n');
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /结构验收通过/);
      assert.match(r.stdout, /详情（可选）/);
      assert.ok(!/Open the HTML report in your browser/.test(r.stdout));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MCP av_session_report 返回 verdict 字段', () => {
  it('report 含 verdict.lines 且 message 等于 verdict.text', () => {
    const { handleToolCall, stopWatcher } = require('../mcp/server');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-verdict-mcp-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'class App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n');
      handleToolCall({ name: 'av_session_start', arguments: { repo: dir } });
      const report = handleToolCall({ name: 'av_session_report', arguments: { repo: dir } });
      assert.ok(report.verdict, '应有 verdict 字段');
      assert.ok(Array.isArray(report.verdict.lines));
      assert.ok(report.verdict.lines.length <= 3);
      assert.equal(report.message, report.verdict.text);
      assert.match(report.verdict.text, /结构验收通过|结构验收/);
      assert.match(report.nextStep, /详情|可选|av_session_start/);
    } finally {
      try { stopWatcher(dir); } catch { /* ignore */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
