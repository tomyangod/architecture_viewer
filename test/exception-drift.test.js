'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings } = require('../lib/risk-rules');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ex-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function riskFrom(filesBefore, filesAfter) {
  const dir = makeRepo(filesBefore);
  const base = buildGraph(dir, { calls: true });
  for (const [rel, content] of Object.entries(filesAfter)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const head = buildGraph(dir, { calls: true });
  const diff = diffGraphs(base, head);
  const findings = evaluateRisk(diff, head, base, null, {});
  return { dir, base, head, diff, findings };
}

describe('W21-01a R19 exception-contract-drift', () => {
  it('JS 新增自定义异常且入口未捕获 → MEDIUM reportOnly', () => {
    const { findings, diff } = riskFrom({
      'src/service/save.js': `
export function save(x) { return x; }
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    }, {
      'src/service/save.js': `
export function save(x) {
  if (!x) throw new QuotaError('no');
  return x;
}
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    });
    assert.ok((diff.behaviorChanges || []).some((c) => (c.addedThrows || []).includes('QuotaError')),
      JSON.stringify(diff.behaviorChanges));
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit, `expected exception-contract-drift, got ${findings.map((f) => f.rule + ':' + f.message)}`);
    assert.equal(hit.severity, 'medium');
    assert.equal(hit.reportOnly, true);
    assert.ok(hit.confidence === 'medium' || hit.confidence === 'low');
    const sum = summarizeFindings(findings);
    assert.equal(summarizeFindings(findings.filter((f) => f.rule === 'exception-contract-drift')).gateLevel, 'none');
    assert.ok(sum.reportOnlyCount >= 1);
  });

  it('入口已 catch 则不报', () => {
    const { findings } = riskFrom({
      'src/service/save.js': `
export function save(x) { return x; }
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() {
  try { return save(1); } catch (e) { return null; }
}
`
    }, {
      'src/service/save.js': `
export function save(x) {
  if (!x) throw new QuotaError('no');
  return x;
}
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() {
  try { return save(1); } catch (e) { return null; }
}
`
    });
    assert.equal(findings.some((f) => f.rule === 'exception-contract-drift'), false,
      findings.filter((f) => f.rule === 'exception-contract-drift').map((f) => f.message).join(';'));
  });

  it('JS throw Error 标 low confidence', () => {
    const { findings } = riskFrom({
      'src/service/save.js': `
export function save(x) { return x; }
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    }, {
      'src/service/save.js': `
export function save(x) { if (!x) throw new Error('no'); return x; }
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    });
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit);
    assert.equal(hit.confidence, 'low');
  });

  it('Python raise 到 controller 无 except → 报，confidence high', () => {
    const { findings } = riskFrom({
      'service/save.py': `
def save(x):
    return x
`,
      'controller/handle.py': `
from service.save import save
def handle():
    return save(1)
`
    }, {
      'service/save.py': `
class QuotaError(Exception):
    pass
def save(x):
    if not x:
        raise QuotaError('no')
    return x
`,
      'controller/handle.py': `
from service.save import save
def handle():
    return save(1)
`
    });
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit, `expected exception-contract-drift, got ${findings.map((f) => f.rule)}`);
    assert.equal(hit.confidence, 'high');
    assert.equal(hit.reportOnly, true);
  });

  it('session 增量路径：只加 throw、结构边不变 → 仍报 R19', () => {
    const { buildGraph, toPersistableGraph, attachCallEdges } = require('../lib/extract-graph');
    const dir = makeRepo({
      'src/service/save.js': `
export function save(x) { return x; }
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    });
    const base = toPersistableGraph(buildGraph(dir));
    fs.writeFileSync(path.join(dir, 'src/service/save.js'), `
export function save(x) {
  if (!x) throw new QuotaError('no');
  return x;
}
`);
    const head = buildGraph(dir);
    attachCallEdges(head, { incremental: true, base });
    const diff = diffGraphs(base, head);
    assert.ok((diff.behaviorChanges || []).some((c) => (c.addedThrows || []).includes('QuotaError')),
      JSON.stringify(diff.behaviorChanges));
    const callCount = (head.edges || []).filter((e) => e.type === 'call').length;
    assert.ok(callCount > 0, 'incremental attach must not early-return with zero call edges');
    const findings = evaluateRisk(diff, head, base, null, {});
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit, `session-shaped path should report R19, got ${findings.map((f) => f.rule)}`);
    assert.equal(hit.reportOnly, true);
  });

  it('同文件无关函数的 catch-all 不压掉 R19（file entrypoint）', () => {
    const { findings, head } = riskFrom({
      'src/service/save.js': `
export function save(x) { return x; }
`,
      'src/controller/server.js': `
import { save } from '../service/save';
export function unrelated() {
  try { return 1; } catch (e) { return null; }
}
export function boot() { return save(1); }
`
    }, {
      'src/service/save.js': `
export function save(x) {
  if (!x) throw new QuotaError('no');
  return x;
}
`,
      'src/controller/server.js': `
import { save } from '../service/save';
export function unrelated() {
  try { return 1; } catch (e) { return null; }
}
export function boot() { return save(1); }
`
    });
    const fileNode = (head.nodes || []).find((n) => n.id === 'file:src/controller/server.js');
    assert.ok(fileNode && (fileNode.catchSites || []).some((c) => c.hasCatchAll && c.owner === 'unrelated'),
      JSON.stringify(fileNode && fileNode.catchSites));
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit, `unrelated catch-all must not swallow R19, got ${findings.map((f) => f.rule + ':' + f.message)}`);
  });

  it('POM 形：backend/routes from services.x import fn 新增 raise → R19', () => {
    const { findings, diff } = riskFrom({
      'backend/services/alerts_service.py': `
def alerts_detail(alert_id):
    return {"id": alert_id}
`,
      'backend/routes/alerts.py': `
from services.alerts_service import alerts_detail
def handle_alerts_detail(alert_id):
    return alerts_detail(alert_id)
`
    }, {
      'backend/services/alerts_service.py': `
class AvObsAlertError(Exception):
    pass
def alerts_detail(alert_id):
    if not alert_id:
        raise AvObsAlertError("no")
    return {"id": alert_id}
`,
      'backend/routes/alerts.py': `
from services.alerts_service import alerts_detail
def handle_alerts_detail(alert_id):
    return alerts_detail(alert_id)
`
    });
    assert.ok((diff.behaviorChanges || []).some((c) => (c.addedThrows || []).includes('AvObsAlertError')),
      JSON.stringify(diff.behaviorChanges));
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit, `POM-shaped sys.path import must walk call edge to controller, got ${findings.map((f) => f.rule + ':' + f.message)}`);
    assert.equal(hit.reportOnly, true);
  });

  it('入口函数自身 try/catch 仍为 TN', () => {
    const { findings } = riskFrom({
      'src/service/save.js': `
export function save(x) { return x; }
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() {
  try { return save(1); } catch (e) { return null; }
}
export function other() {
  try { return 2; } catch (e) { return 0; }
}
`
    }, {
      'src/service/save.js': `
export function save(x) {
  if (!x) throw new QuotaError('no');
  return x;
}
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() {
  try { return save(1); } catch (e) { return null; }
}
export function other() {
  try { return 2; } catch (e) { return 0; }
}
`
    });
    assert.equal(findings.some((f) => f.rule === 'exception-contract-drift'), false,
      findings.filter((f) => f.rule === 'exception-contract-drift').map((f) => f.message).join(';'));
  });

  it('file 入口忽略 require 兜底类模块级 catch-all → 仍报 R19', () => {
    const { findings, head } = riskFrom({
      'src/lib/scan.js': `
export function scan(x) { return x; }
`,
      'src/web/server.js': `
let optional = null;
try { optional = require('./missing-optional'); } catch { optional = null; }
import { scan } from '../lib/scan';
scan(1);
`
    }, {
      'src/lib/scan.js': `
export function scan(x) {
  if (!x) throw new AvObsError('no');
  return x;
}
`,
      'src/web/server.js': `
let optional = null;
try { optional = require('./missing-optional'); } catch { optional = null; }
import { scan } from '../lib/scan';
scan(1);
`
    });
    const fileNode = (head.nodes || []).find((n) => n.id === 'file:src/web/server.js');
    assert.ok(fileNode && (fileNode.catchSites || []).some((c) => c.loadGuard && c.hasCatchAll),
      'expected loadGuard catch site: ' + JSON.stringify(fileNode && fileNode.catchSites));
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit, `loadGuard must not swallow R19, got ${findings.map((f) => f.rule + ':' + f.message)}`);
  });

  it('原点函数无关 catch-all 不词法包围 throw → 仍报 R19', () => {
    const { findings } = riskFrom({
      'src/service/save.js': `
export function save(x) {
  try { void x; } catch (e) { /* unrelated */ }
  return x;
}
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    }, {
      'src/service/save.js': `
export function save(x) {
  try { void x; } catch (e) { /* unrelated */ }
  if (!x) throw new QuotaError('no');
  return x;
}
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    });
    const hit = findings.find((f) => f.rule === 'exception-contract-drift');
    assert.ok(hit, `origin unrelated catch-all must not swallow, got ${findings.map((f) => f.rule)}`);
  });

  it('原点 throw 被同函数 try 词法包围 → TN', () => {
    const { findings } = riskFrom({
      'src/service/save.js': `
export function save(x) { return x; }
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    }, {
      'src/service/save.js': `
export function save(x) {
  try {
    if (!x) throw new QuotaError('no');
    return x;
  } catch (e) {
    return null;
  }
}
`,
      'src/controller/handle.js': `
import { save } from '../service/save';
export function handle() { return save(1); }
`
    });
    assert.equal(findings.some((f) => f.rule === 'exception-contract-drift'), false,
      findings.filter((f) => f.rule === 'exception-contract-drift').map((f) => f.message).join(';'));
  });
});
