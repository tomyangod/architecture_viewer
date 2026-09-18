'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk } = require('../lib/risk-rules');
const { buildReviewWalk, formatReviewWalkText } = require('../lib/review-walk');
const { buildReportData, generateReport } = require('../lib/session-report');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-walk-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.mkdirSync(path.join(dir, '.av'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.av/layers.json'), JSON.stringify({
    controller: 'controller',
    service: 'service',
    repository: 'storage'
  }));
  return dir;
}

describe('P0 Review Walk', () => {
  it('从入口按调用边排出阅读顺序，并标出越层与 sink', () => {
    const dir = makeRepo({
      'controller/order_controller.py': `
from service.order_service import OrderService
class OrderController:
    def __init__(self, svc: OrderService):
        self.svc = svc
    def pay(self, order_id):
        return self.svc.pay(order_id)
`,
      'service/order_service.py': `
from domain.order import Order
from repository.order_repository import OrderRepository
class OrderService:
    def __init__(self, repo: OrderRepository):
        self.repo = repo
    def pay(self, order_id):
        order = self.repo.find(order_id)
        order.mark_paid()
        self.repo.save(order)
        return order
`,
      'repository/order_repository.py': `
from domain.order import Order
class OrderRepository:
    def find(self, order_id):
        return Order(order_id)
    def save(self, order: Order):
        return order
`,
      'domain/order.py': `
class Order:
    def __init__(self, order_id):
        self.id = order_id
        self.paid = False
    def mark_paid(self):
        self.paid = True
`
    });
    const base = buildGraph(dir, { calls: true });
    fs.writeFileSync(path.join(dir, 'service/payment_service.py'), `
from domain.order import Order
from repository.order_repository import OrderRepository
class PaymentService:
    def __init__(self, repo: OrderRepository):
        self.repo = repo
    def charge(self, order: Order):
        return self.repo.save(order)
`);
    fs.writeFileSync(path.join(dir, 'controller/order_controller.py'), `
from service.order_service import OrderService
from service.payment_service import PaymentService
from repository.order_repository import OrderRepository
class OrderController:
    def __init__(self, svc: OrderService, pay: PaymentService, repo: OrderRepository):
        self.svc = svc
        self.pay = pay
        self.repo = repo
    def pay(self, order_id):
        order = self.svc.pay(order_id)
        self.pay.charge(order)
        return order
`);
    const head = buildGraph(dir, { calls: true });
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {});
    const walk = buildReviewWalk({ headGraph: head, baseGraph: base, diff, findings });

    assert.ok(walk.steps.length >= 2, `expected ≥2 steps, got ${JSON.stringify(walk.stats)}`);
    assert.ok(walk.entry, 'should pick an entry');
    assert.ok(
      walk.entry.layer === 'controller' || /controller/i.test(walk.entry.path || ''),
      `entry should be controller-ish: ${JSON.stringify(walk.entry)}`
    );
    const names = walk.steps.map((s) => s.name).join(' ');
    assert.match(names, /PaymentService|OrderController|OrderService/);
    assert.ok(walk.skips.length >= 1 || walk.steps.some((s) => s.layerSkip),
      `expected layer-skip signal: skips=${walk.skips.length} steps=${JSON.stringify(walk.steps.map(s => ({ n: s.name, skip: s.layerSkip })))}`);
    const pay = walk.steps.find((s) => /PaymentService/i.test(s.name));
    assert.ok(pay, `PaymentService should be in walk: ${walk.steps.map((s) => s.name)}`);
    assert.ok(
      (pay.sinks || []).some((s) => s.kind === 'storage' && /save/i.test(s.name)),
      `PaymentService should show storage:save sink, got ${JSON.stringify(pay.sinks)}`
    );

    const text = formatReviewWalkText(walk, { reportPath: '.av/session-report.html' });
    const nLines = text.split('\n').filter(Boolean).length;
    assert.ok(nLines <= 8, `walk text must be ≤8 lines, got ${nLines}:\n${text}`);
    assert.match(text, /审查走查/);

    const report = buildReportData(base, head, diff, findings, null, 'walk-demo', null);
    assert.ok(report.reviewWalk);
    assert.equal(report.reviewWalk.stats.stepCount, walk.stats.stepCount);
    assert.ok(Array.isArray(report.callEdges));
    const payEnt = report.entities.find((e) => e.name === 'PaymentService');
    assert.ok(payEnt && payEnt.sinks && payEnt.sinks.some((s) => s.kind === 'storage'));

    const html = generateReport({
      baseGraph: base, headGraph: head, diff, findings, impact: null,
      repoName: 'walk-demo', sessionStart: null
    });
    assert.match(html, /审查走查/);
    assert.match(html, /id="walk-section"/);
    assert.match(html, /id="walk-step-/);
    assert.match(html, /graph-details/);
    assert.ok(html.includes('PaymentService') || html.includes('OrderController'));
  });

  it('无变更时返回空走查，不抛错', () => {
    const walk = buildReviewWalk({
      headGraph: { nodes: [], edges: [], fingerprint: 'a' },
      baseGraph: { nodes: [], edges: [], fingerprint: 'a' },
      diff: {
        addedNodes: [], removedNodes: [], modifiedNodes: [], movedNodes: [],
        renamedNodes: [], addedEdges: [], removedEdges: [], violations: [],
        behaviorChanges: [], implChanges: [], summary: {}
      },
      findings: []
    });
    assert.equal(walk.steps.length, 0);
    assert.equal(walk.stats.entryFound, false);
  });

  it('模块级调用边进入 Delta：callEdges 与 edge-path.call', () => {
    const dir = makeRepo({
      'src/todo.js': 'export function createTodo(title) { return title; }\n',
      'src/routes.js': "import { createTodo } from './todo';\nexport function handle() { return createTodo('x'); }\n"
    });
    const base = buildGraph(dir, { calls: true });
    fs.writeFileSync(path.join(dir, 'src/todo.js'),
      'export function createTodo(title, owner) { return title + owner; }\n');
    const head = buildGraph(dir, { calls: true });
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {});
    const report = buildReportData(base, head, diff, findings, null, 'call-demo', null);
    assert.ok(report.callEdges.some((e) => e.type === 'call'),
      `expected call edges, got ${JSON.stringify(report.callEdges)}`);
    const html = generateReport({
      baseGraph: base, headGraph: head, diff, findings, impact: null,
      repoName: 'call-demo', sessionStart: null
    });
    assert.match(html, /edge-path\.call/);
    assert.match(html, /D\.callEdges/);
  });
});
