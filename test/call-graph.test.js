'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph, toPersistableGraph, attachCallEdges } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { CALL_EDGE, UNRESOLVED_EDGE, UNRESOLVED_ID } = require('../lib/extract/call-graph');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-calls-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function callEdges(graph) {
  return (graph.edges || []).filter((e) => e.type === CALL_EDGE);
}

function unresolvedEdges(graph) {
  return (graph.edges || []).filter((e) => e.type === UNRESOLVED_EDGE);
}

describe('call-graph: 五语言调用边', () => {
  it('JS 同文件函数调用：caller → callee', () => {
    const dir = makeRepo({
      'src/app.js': `
export function helper() { return 1; }
export function run() { return helper(); }
`
    });
    const g = buildGraph(dir, { calls: true });
    const edge = callEdges(g).find((e) => e.from.endsWith('#run') && e.to.endsWith('#helper'));
    assert.ok(edge, 'run → helper call edge');
    assert.equal(edge.confidence, 'high');
    assert.equal(edge.callee, 'helper');
  });

  it('JS 跨文件 named import 绑定', () => {
    const dir = makeRepo({
      'src/todo.js': `
export function createTodo(title) { return title; }
`,
      'src/routes.js': `
import { createTodo } from './todo';
export function handle() { return createTodo('x'); }
`
    });
    const g = buildGraph(dir, { calls: true });
    const edge = callEdges(g).find((e) => e.from.includes('routes') && e.to.includes('todo#createTodo'));
    assert.ok(edge, `expected routes → todo#createTodo, got ${JSON.stringify(callEdges(g))}`);
  });

  it('JS 动态调用落 unresolved-call + low confidence', () => {
    const dir = makeRepo({
      'src/dyn.js': `
export function run(obj, key) { return obj[key](); }
`
    });
    const g = buildGraph(dir, { calls: true });
    const u = unresolvedEdges(g);
    assert.ok(u.length >= 1, 'dynamic call should be unresolved');
    assert.equal(u[0].confidence, 'low');
    assert.equal(u[0].to, UNRESOLVED_ID);
    assert.ok(g.nodes.some((n) => n.id === UNRESOLVED_ID && n.kind === 'unresolved-call'));
  });

  it('Python from-import 调用绑定', () => {
    const dir = makeRepo({
      'models/order.py': `
class Order:
    def total(self):
        return 0
`,
      'services/order_service.py': `
from models.order import Order

def create():
    return Order()
`
    });
    const g = buildGraph(dir, { calls: true });
    const edge = callEdges(g).find((e) => e.from.endsWith('order_service#create') && e.to.endsWith('order#Order'));
    assert.ok(edge, `expected create → Order, got ${JSON.stringify(callEdges(g))}`);
  });

  it('Java new / 静态类型调用经 import 绑定', () => {
    const dir = makeRepo({
      'src/main/java/com/shop/Order.java': `
package com.shop;
public class Order {
    public int total() { return 0; }
}
`,
      'src/main/java/com/shop/OrderService.java': `
package com.shop;
public class OrderService {
    public Order create() {
        return new Order();
    }
}
`
    });
    const g = buildGraph(dir, { calls: true });
    const edge = callEdges(g).find((e) => e.from === 'com.shop.OrderService' && e.to === 'com.shop.Order');
    assert.ok(edge, `expected OrderService → Order, got ${JSON.stringify(callEdges(g))}`);
  });

  it('Go 包选择器调用经 import 绑定', () => {
    const dir = makeRepo({
      'go.mod': 'module example.com/shop\n',
      'domain/order.go': `
package domain
func NewOrder() int { return 1 }
`,
      'service/svc.go': `
package service
import "example.com/shop/domain"
func Create() int { return domain.NewOrder() }
`
    });
    const g = buildGraph(dir, { calls: true });
    const edge = callEdges(g).find((e) => e.from.endsWith('service#Create') && e.to.endsWith('domain#NewOrder'));
    assert.ok(edge, `expected Create → NewOrder, got ${JSON.stringify(callEdges(g))}`);
  });

  it('默认 buildGraph 不把 call 边算进结构指纹', () => {
    const dir = makeRepo({
      'src/a.js': `
export function b() { return 1; }
export function a() { return b(); }
`
    });
    const g1 = buildGraph(dir);
    const g2 = buildGraph(dir, { calls: true });
    assert.equal(g1.fingerprint, g2.fingerprint);
    assert.equal(callEdges(g1).length, 0);
    assert.ok(callEdges(g2).length >= 1);
  });

  it('基线快照不存储 call 图 / _callCtx', () => {
    const dir = makeRepo({
      'src/a.js': `
export function b() { return 1; }
export function a() { return b(); }
`
    });
    const g = buildGraph(dir, { calls: true });
    const snap = toPersistableGraph(g);
    assert.equal(callEdges(snap).length, 0);
    assert.equal(unresolvedEdges(snap).length, 0);
    assert.ok(!snap._callCtx);
    assert.ok(!snap.nodes.some((n) => n.id === UNRESOLVED_ID));
    const raw = JSON.stringify(snap);
    assert.ok(!raw.includes('_callCtx'));
    assert.equal(snap.fingerprint, g.fingerprint);
  });

  it('增量：只解析变更文件闭包（changed + 反向 import）', () => {
    const dir = makeRepo({
      'src/todo.js': `
export function createTodo() { return 1; }
`,
      'src/routes.js': `
import { createTodo } from './todo';
export function handle() { return createTodo(); }
`,
      'src/other.js': `
export function helper() { return 2; }
export function unused() { return helper(); }
`
    });
    const base = buildGraph(dir);
    fs.writeFileSync(path.join(dir, 'src/todo.js'), `
export function createTodo() { return 2; }
`);
    const head = buildGraph(dir);
    attachCallEdges(head, { incremental: true, base });
    const calls = callEdges(head);
    assert.ok(calls.some((e) => e.from.includes('routes') && e.to.includes('createTodo')),
      `closure should include reverse importer routes.js: ${JSON.stringify(calls)}`);
    assert.ok(!calls.some((e) => e.from.includes('other')),
      'unrelated other.js must not be resolved incrementally');
  });

  it('diffGraphs 忽略 call 边，避免基线无 call 时全量误报', () => {
    const dir = makeRepo({
      'src/a.js': `
export function b() { return 1; }
export function a() { return b(); }
`
    });
    const base = buildGraph(dir);
    const head = buildGraph(dir, { calls: true });
    const diff = diffGraphs(base, head);
    assert.equal(diff.summary.addedEdges, 0);
    assert.equal(diff.summary.addedNodes, 0);
    assert.equal(base.fingerprint, head.fingerprint);
  });
});
