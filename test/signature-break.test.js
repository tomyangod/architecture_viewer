'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs, formatDiffText, SEMANTIC_NODE_FIELDS } = require('../lib/diff-graph');
const { evaluateRisk, suggestForFinding } = require('../lib/risk-rules');
const { buildReportData } = require('../lib/session-report');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-sig-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('W19-01b: 签名指纹 + R14/R15', () => {
  it('SEMANTIC_NODE_FIELDS 纳入 signature', () => {
    assert.ok(SEMANTIC_NODE_FIELDS.includes('signature'));
  });

  it('diff 列出 params: N→M 与 returnTypes 变化', () => {
    const dir = makeRepo({
      'src/todo.js': `
export function createTodo(title) { return title; }
`
    });
    const base = buildGraph(dir);
    fs.writeFileSync(path.join(dir, 'src/todo.js'), `
export function createTodo(title, owner) { return { title, owner }; }
`);
    const head = buildGraph(dir);
    const diff = diffGraphs(base, head);
    const mod = diff.modifiedNodes.find((m) => String(m.id).endsWith('#createTodo'));
    assert.ok(mod, `createTodo should be modified: ${JSON.stringify(diff.modifiedNodes)}`);
    const params = mod.changes.find((c) => c.field === 'params');
    assert.ok(params, `expected params change, got ${JSON.stringify(mod.changes)}`);
    assert.equal(params.from, 1);
    assert.equal(params.to, 2);
    const text = formatDiffText(diff);
    assert.match(text, /params: 1 → 2/);
  });

  it('R14：调用点实参不够 → HIGH，证据列出调用点', () => {
    const dir = makeRepo({
      'src/todo.js': `
export function createTodo(title) { return title; }
`,
      'src/routes.js': `
import { createTodo } from './todo';
export function handle() { return createTodo('x'); }
`
    });
    const base = buildGraph(dir, { calls: true });
    fs.writeFileSync(path.join(dir, 'src/todo.js'), `
export function createTodo(title, owner) { return title + owner; }
`);
    const head = buildGraph(dir, { calls: true });
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {});
    const hit = findings.find((f) => f.rule === 'signature-break');
    assert.ok(hit, `expected signature-break, got ${findings.map((f) => f.rule)}`);
    assert.equal(hit.severity, 'high');
    assert.ok(hit.evidence && hit.evidence.length >= 1);
    assert.ok(hit.detail.includes('params: 1→2') || hit.detail.includes('实参'));
    assert.match(suggestForFinding(hit), /签名/);
  });

  it('R14：新增可选参数、调用点仍兼容 → INFO', () => {
    const dir = makeRepo({
      'src/todo.ts': `
export function createTodo(title: string) { return title; }
`,
      'src/routes.ts': `
import { createTodo } from './todo';
export function handle() { return createTodo('x'); }
`
    });
    const base = buildGraph(dir, { calls: true });
    fs.writeFileSync(path.join(dir, 'src/todo.ts'), `
export function createTodo(title: string, owner?: string) { return title; }
`);
    const head = buildGraph(dir, { calls: true });
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {});
    const hit = findings.find((f) => f.rule === 'signature-break');
    assert.ok(hit, `expected signature-break INFO, changes=${JSON.stringify(diff.modifiedNodes)}`);
    assert.equal(hit.severity, 'info');
  });

  it('R15：变更文件 unresolved 调用聚集 → LOW', () => {
    const dir = makeRepo({
      'src/dyn.js': `
export function run(obj, key) { return 1; }
`
    });
    const base = buildGraph(dir, { calls: true });
    fs.writeFileSync(path.join(dir, 'src/dyn.js'), `
export function run(obj, key) {
  obj[key]();
  obj[key + 'a']();
  obj[key + 'b']();
}
`);
    const head = buildGraph(dir, { calls: true });
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {});
    const hit = findings.find((f) => f.rule === 'unresolved-call-cluster');
    assert.ok(hit, `expected unresolved-call-cluster, got ${findings.map((f) => f.rule)}`);
    assert.equal(hit.severity, 'low');
  });

  it('CLI/HTML/JSON 共用 evaluateRisk：同一 finding 的 rule/severity/title', () => {
    const dir = makeRepo({
      'src/todo.js': `export function createTodo(title) { return title; }\n`,
      'src/routes.js': `import { createTodo } from './todo';\nexport function handle() { return createTodo('x'); }\n`
    });
    const base = buildGraph(dir, { calls: true });
    fs.writeFileSync(path.join(dir, 'src/todo.js'), `export function createTodo(title, owner) { return title; }\n`);
    const head = buildGraph(dir, { calls: true });
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {});
    const payload = buildReportData(base, head, diff, findings, null, 'sig-repo', null);
    const jsonHit = payload.risk.findings.find((f) => f.rule === 'signature-break');
    const evalHit = findings.find((f) => f.rule === 'signature-break');
    assert.ok(jsonHit && evalHit);
    assert.equal(jsonHit.rule, evalHit.rule);
    assert.equal(jsonHit.severity, evalHit.severity);
    assert.equal(jsonHit.title, evalHit.title);
    assert.equal(payload.risk.level, 'high');
    const html = require('../lib/session-report').generateReport({
      baseGraph: base, headGraph: head, diff, findings, impact: null, repoName: 'sig-repo'
    });
    assert.match(html, /signature-break|导出签名变更/);
    assert.match(html, /params: 1 → 2|params: 1→2/);
  });

  it('旧基线缺 signature 字段不制造全量 modified', () => {
    const dir = makeRepo({
      'src/todo.js': `export function createTodo(title) { return title; }\n`
    });
    const head = buildGraph(dir);
    const base = JSON.parse(JSON.stringify(require('../lib/extract-graph').toPersistableGraph(head)));
    for (const n of base.nodes) delete n.signature;
    const diff = diffGraphs(base, head);
    assert.equal(diff.modifiedNodes.filter((m) => (m.changes || []).some((c) => c.field === 'params' || c.field === 'signature')).length, 0);
  });
});
