'use strict';

// W15-06: HIGH finding 三端一致（CLI / MCP / HTML）
//
// 验收标准：
//   同一仓库同一改动，CLI 退出码 1、MCP 返回 riskLevel=high、HTML 显示红灯，
//   三者 finding 数量和标题一致
//
// 三端数据流：
//   CLI  → evaluateRisk() → formatFindingsText() → stdout
//   MCP  → evaluateRisk() → formatFinding() → result.findings + result.riskLevel
//   HTML → evaluateRisk() → buildReportData().risk.findings → DOM
//
// 三端共用同一 evaluateRisk() 调用，finding 对象结构一致（rule/severity/title/message），
// 因此 finding 数量和标题天然一致。测试验证端到端不漂移。

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');
const { toolSessionStart, toolSessionReport, stopWatcher } = require('../mcp/server');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

// 构造一个有跨层违规的 repo：
// storage 层 (models/db.js) import controller 层 (controllers/api.js)
// LAYER_RANK: storage=1 < controller=4 → isReverseDependency=true → HIGH cross-layer-violation
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1506-'));
  fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });

  // controller 层
  fs.writeFileSync(path.join(dir, 'controllers', 'api.js'),
    'function handle(req) { return req; }\nmodule.exports = { handle };\n');

  // storage 层（干净，无违规）
  fs.writeFileSync(path.join(dir, 'models', 'db.js'),
    'class DB { save(x) { return x; } }\nmodule.exports = { DB };\n');

  return dir;
}

describe('W15-06: HIGH finding 三端一致（CLI/MCP/HTML）', () => {
  let dir;

  after(() => {
    stopWatcher(dir);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── 构造跨层违规 → 三端验证 ──
  it('同一跨层违规：CLI exit=1 / MCP riskLevel=high / HTML 红灯，finding 数量和标题一致', () => {
    dir = makeRepo();

    // 1. 基线
    let r = run(['session', 'start', dir], dir);
    assert.equal(r.status, 0, r.stderr);

    // 2. 制造跨层违规：storage 层 import controller 层
    fs.writeFileSync(path.join(dir, 'models', 'db.js'),
      'const { handle } = require("../controllers/api");\n' +
      'class DB { save(x) { handle(x); return x; } }\n' +
      'module.exports = { DB };\n');

    // ── 端 1: CLI ──
    const cliResult = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
    assert.equal(cliResult.status, 1, `CLI 应 exit 1（HIGH 风险），实际 exit ${cliResult.status}`);
    assert.match(cliResult.stdout, /跨层依赖违规/, 'CLI 应含「跨层依赖违规」finding');
    assert.match(cliResult.stdout, /HIGH/, 'CLI 应标 HIGH');

    // 提取 CLI 的 finding 标题
    const cliTitles = [];
    for (const line of cliResult.stdout.split('\n')) {
      const m = line.match(/\[(?:HIGH|MEDIUM|LOW|INFO)\]\s*(.+?):/);
      if (m) cliTitles.push(m[1].trim());
    }
    assert.ok(cliTitles.length > 0, 'CLI 应至少有 1 个 finding');

    // ── 端 2: MCP ──
    const mcpResult = toolSessionReport({ repo: dir });
    assert.equal(mcpResult.riskLevel, 'high', `MCP riskLevel 应为 high，实际 ${mcpResult.riskLevel}`);
    assert.ok(mcpResult.findings.length > 0, 'MCP 应至少有 1 个 finding');
    const mcpTitles = mcpResult.findings.map(f => f.title);

    // ── 端 3: HTML ──
    const html = fs.readFileSync(path.join(dir, '.av', 'session-report.html'), 'utf8');
    // 红灯 badge
    assert.match(html, /risk-badge.*high/, 'HTML 应有 high 风险 badge');
    // finding 标题在 REPORT_DATA 里
    assert.match(html, /跨层依赖违规/, 'HTML 应含「跨层依赖违规」finding');

    // 从 HTML 提取 REPORT_DATA 里的 finding 标题
    const dataLine = html.split('\n').find(l => l.includes('const REPORT_DATA = {'));
    const rd = JSON.parse(dataLine.replace('const REPORT_DATA = ', '').replace(/;$/, ''));
    const htmlTitles = rd.risk.findings.map(f => f.title);

    // ── 三端一致性断言 ──
    // A. finding 数量一致
    assert.equal(cliTitles.length, mcpResult.findings.length,
      `finding 数量不一致：CLI=${cliTitles.length} MCP=${mcpResult.findings.length}`);
    assert.equal(cliTitles.length, htmlTitles.length,
      `finding 数量不一致：CLI=${cliTitles.length} HTML=${htmlTitles.length}`);

    // B. finding 标题集合一致（排序后逐条比较）
    const sorted = (arr) => [...arr].sort();
    assert.deepEqual(sorted(cliTitles), sorted(mcpTitles),
      `CLI 和 MCP finding 标题不一致：CLI=${JSON.stringify(cliTitles)} MCP=${JSON.stringify(mcpTitles)}`);
    assert.deepEqual(sorted(cliTitles), sorted(htmlTitles),
      `CLI 和 HTML finding 标题不一致：CLI=${JSON.stringify(cliTitles)} HTML=${JSON.stringify(htmlTitles)}`);

    // C. 三端都有 HIGH 严重级别
    assert.ok(mcpResult.findings.some(f => f.severity === 'high'), 'MCP 应有 HIGH severity finding');
    assert.ok(rd.risk.findings.some(f => f.severity === 'high'), 'HTML 应有 HIGH severity finding');
    assert.match(cliResult.stdout, /HIGH/, 'CLI 应有 HIGH 标记');

    // D. HTML 权威风险 = risk.level；summary 只保留 changeScale
    assert.equal(rd.risk.level, 'high', `HTML risk.level 应为 high，实际 ${rd.risk.level}`);
    assert.equal(rd.summary.riskLevel, undefined, 'HTML summary 不得再带 riskLevel');
    assert.ok(rd.summary.changeScale, 'HTML summary.changeScale 应存在');
    assert.equal(mcpResult.summary.riskLevel, 'high');
    assert.equal(mcpResult.riskLevel, mcpResult.summary.riskLevel);
  });

  // ── 验证三端 finding 的 rule 字段也一致 ──
  it('三端 finding 的 rule 字段一致', () => {
    // 上一轮已经 session start + report 了，直接读产物
    const json = JSON.parse(fs.readFileSync(path.join(dir, '.av', 'session-report.json'), 'utf8'));
    const html = fs.readFileSync(path.join(dir, '.av', 'session-report.html'), 'utf8');
    const dataLine = html.split('\n').find(l => l.includes('const REPORT_DATA = {'));
    const rd = JSON.parse(dataLine.replace('const REPORT_DATA = ', '').replace(/;$/, ''));

    assert.equal(json.schemaVersion, 2);
    assert.equal(json.risk.level, 'high', `落盘 JSON risk.level 应为 high，实际 ${json.risk.level}`);
    assert.equal(json.riskSummary.level, json.risk.level);
    assert.equal(json.risk.level, rd.risk.level);
    assert.equal(json.summary.changeScale, rd.summary.changeScale);
    assert.equal(json.diff.summary.riskLevel, undefined);

    // JSON findings
    const jsonRules = json.findings.map(f => f.rule).sort();
    // HTML findings
    const htmlRules = rd.risk.findings.map(f => f.rule).sort();
    // MCP findings（重新调用 report）
    const mcpResult = toolSessionReport({ repo: dir });
    const mcpRules = mcpResult.findings.map(f => f.rule).sort();

    assert.deepEqual(jsonRules, htmlRules, `JSON 和 HTML rule 不一致`);
    assert.deepEqual(jsonRules, mcpRules, `JSON 和 MCP rule 不一致`);
  });
});
