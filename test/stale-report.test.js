'use strict';

// W15-04: 刷新基线后旧报告不误读
//
// 验收标准：
//   1. session start 后旧 HTML/JSON 被清除
//   2. 删不掉的残留文件顶部有过期标记（覆写为过期存根）
//   3. 用户不会把旧红灯当成当前结果（JSON 过期存根 findings 置空、回读方识别 stale）
//
// 防御层次：
//   A. 正常路径：session start 删除 .av/ 下全部 session-report* / archify-* 产物
//   B. 兜底路径：删除失败（文件占用/权限）→ HTML 覆写为「已过期」页，JSON 覆写为 stale 存根
//   C. 自识别：  生成的 HTML 顶部恒有「📸 点时快照」横幅，任何旧副本都能看出是快照
//   D. 回读保护：MCP explain 读到 stale 存根 / 缺指纹报告时拒绝返回旧 findings

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  clearStaleSessionReports,
  buildSessionReportJson,
  isStaleReport,
  staleHtmlStub,
  staleJsonStub,
  STALE_SESSION_NAME_RE
} = require('../lib/session-report');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1504-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.py'), 'class App:\n    pass\n');
  return dir;
}

const REPORT_ARTIFACTS = [
  'session-report.json',
  'session-report.html',
  'session-report.builtin.html',
  'session-report.archify.html',
  'archify-changed.base.json',
  'archify-changed.head.json',
  'archify-changed.sidecar.json'
];

describe('W15-04: 刷新基线后旧报告不误读', () => {

  // ── A. 正常清理：session start 删除全部报告产物 ──
  it('A. clearStaleSessionReports 删除全部 session-report*/archify-* 产物，保留 baseline/layers/history', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1504-clean-'));
    const av = path.join(dir, '.av');
    fs.mkdirSync(av, { recursive: true });
    try {
      for (const f of REPORT_ARTIFACTS) fs.writeFileSync(path.join(av, f), 'STALE_CONTENT');
      // 不应被清理的文件
      fs.writeFileSync(path.join(av, 'graph-baseline.json'), '{}');
      fs.writeFileSync(path.join(av, 'layers.json'), '{}');
      fs.writeFileSync(path.join(av, 'layers.suggested.json'), '{}');
      fs.writeFileSync(path.join(av, 'session-history.jsonl'), '{}\n');

      const result = clearStaleSessionReports(dir);

      // 全部删除，无存根
      assert.equal(result.deleted.length, REPORT_ARTIFACTS.length);
      assert.deepEqual(result.stubbed, []);
      for (const f of REPORT_ARTIFACTS) {
        assert.ok(!fs.existsSync(path.join(av, f)), `${f} 应被删除`);
      }
      // 基线 / 分层 / 历史保留
      assert.ok(fs.existsSync(path.join(av, 'graph-baseline.json')), 'baseline 必须保留');
      assert.ok(fs.existsSync(path.join(av, 'layers.json')), 'layers 必须保留');
      assert.ok(fs.existsSync(path.join(av, 'session-history.jsonl')), 'session-history 必须保留');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── B. 兜底：unlink 失败时覆写为过期存根 ──
  it('B. 删除失败时 HTML 覆写为「已过期」页、JSON 覆写为 stale 存根（findings 置空）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1504-stub-'));
    const av = path.join(dir, '.av');
    fs.mkdirSync(av, { recursive: true });
    try {
      const htmlFile = path.join(av, 'session-report.html');
      const jsonFile = path.join(av, 'session-report.json');
      const archifyJson = path.join(av, 'archify-changed.head.json');
      fs.writeFileSync(htmlFile, '<html><body>旧红灯 HIGH 跨层违规</body></html>');
      fs.writeFileSync(jsonFile, JSON.stringify({ findings: [{ rule: 'cross-layer', severity: 'high' }] }));
      fs.writeFileSync(archifyJson, '{}');

      // 模拟文件被占用：unlink 抛错（writeFileSync 仍可用）
      const origUnlink = fs.unlinkSync;
      fs.unlinkSync = () => { throw new Error('EBUSY: resource busy or locked'); };
      let result;
      try {
        result = clearStaleSessionReports(dir);
      } finally {
        fs.unlinkSync = origUnlink;
      }

      // 没删掉，但全部覆写为存根
      assert.deepEqual(result.deleted, []);
      assert.equal(result.stubbed.length, 3);

      // HTML 残留文件顶部就是「已过期」
      const html = fs.readFileSync(htmlFile, 'utf8');
      assert.match(html, /报告已过期/, 'HTML 存根必须含「报告已过期」');
      assert.match(html, /session report/, 'HTML 存根必须提示重新生成');
      assert.ok(!html.includes('旧红灯'), '旧红灯内容必须被覆写掉');

      // JSON 存根：stale=true 且 findings 为空，回读方拿不到旧 finding
      const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      assert.equal(json.stale, true);
      assert.deepEqual(json.findings, []);
      assert.ok(isStaleReport(json), 'isStaleReport 必须识别 JSON 存根');

      // archify IR 也被覆写为 stale JSON
      const archify = JSON.parse(fs.readFileSync(archifyJson, 'utf8'));
      assert.equal(archify.stale, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── 存根内容单元测试 ──
  it('B2. staleHtmlStub 含过期标题与重新生成指引', () => {
    const html = staleHtmlStub('2026-09-08T10:00:00.000Z');
    assert.match(html, /报告已过期/);
    assert.match(html, /arch-viewer session report/);
    assert.match(html, /<title>报告已过期/);
  });

  it('B3. staleJsonStub 可被 isStaleReport 识别，且 findings 为空', () => {
    const json = JSON.parse(staleJsonStub('2026-09-08T10:00:00.000Z'));
    assert.equal(json.stale, true);
    assert.deepEqual(json.findings, []);
    assert.equal(json.diff, null);
    assert.equal(json.schemaVersion, 2);
    assert.equal(json.risk.level, 'none');
    assert.ok(isStaleReport(json));
  });

  // ── D. isStaleReport 判定 ──
  it('D. isStaleReport 对正常报告 false，对过期存根 true', () => {
    const normal = buildSessionReportJson({
      diff: { summary: {} }, findings: [], riskSummary: { level: 'none' },
      impact: null, baseGraph: { fingerprint: 'b1' }, headGraph: { fingerprint: 'h1' }
    });
    assert.equal(isStaleReport(normal), false);
    assert.equal(normal.stale, false);
    assert.ok(normal.generatedAt);
    assert.equal(normal.baseFingerprint, 'b1');
    assert.equal(normal.headFingerprint, 'h1');
    assert.equal(normal.schemaVersion, 2);
    assert.equal(normal.risk.level, 'none');
    assert.equal(normal.riskSummary.level, 'none');

    assert.equal(isStaleReport(JSON.parse(staleJsonStub())), true);
    assert.equal(isStaleReport(null), false);
    assert.equal(isStaleReport({}), false);
    assert.equal(isStaleReport({ stale: true }), true);
  });

  // ── C. 生成的 HTML 顶部恒有快照横幅 ──
  it('C. CLI 生成的 HTML 顶部含「点时快照」横幅 + 生成时间 + 非实时提示', () => {
    const dir = makeRepo();
    try {
      const start = run(['session', 'start', dir], dir);
      assert.equal(start.status, 0, start.stderr);
      const rep = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(rep.status, 0, rep.stderr + rep.stdout);
      const html = fs.readFileSync(path.join(dir, '.av', 'session-report.html'), 'utf8');
      assert.match(html, /点时快照/, 'HTML 顶部必须有快照横幅');
      assert.match(html, /不是实时状态/, '必须声明非实时状态');
      assert.match(html, /snapshot-bar/, '必须有快照横幅样式类');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── A 端到端：session start 后旧报告文件被清除 ──
  it('A2. CLI 端到端：report 生成产物 → 再次 session start 后产物消失、baseline 保留', () => {
    const dir = makeRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);

      const av = path.join(dir, '.av');
      assert.ok(fs.existsSync(path.join(av, 'session-report.json')), '报告 JSON 应已生成');
      assert.ok(fs.existsSync(path.join(av, 'session-report.html')), '报告 HTML 应已生成');

      r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Cleared stale session report/);

      assert.ok(!fs.existsSync(path.join(av, 'session-report.json')), '旧 JSON 应被清除');
      assert.ok(!fs.existsSync(path.join(av, 'session-report.html')), '旧 HTML 应被清除');
      assert.ok(!fs.existsSync(path.join(av, 'session-report.builtin.html')), 'builtin HTML 应被清除');
      assert.ok(fs.existsSync(path.join(av, 'graph-baseline.json')), 'baseline 必须保留');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── 正则覆盖：所有报告产物名都应被清理正则命中 ──
  it('E. 清理正则覆盖全部已知报告产物文件名', () => {
    for (const f of REPORT_ARTIFACTS) {
      assert.ok(STALE_SESSION_NAME_RE.test(f), `${f} 应被 STALE_SESSION_NAME_RE 命中`);
    }
    // 不应误删
    for (const keep of ['graph-baseline.json', 'layers.json', 'layers.suggested.json', 'session-history.jsonl', 'team-rules.json']) {
      assert.ok(!STALE_SESSION_NAME_RE.test(keep), `${keep} 不应被清理正则命中`);
    }
  });
});
