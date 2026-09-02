'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph, extractGraphTo } = require('../lib/extract-graph');
const { diffGraphs, formatDiffText } = require('../lib/diff-graph');

/* --- 临时仓库 fixture --- */
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-extract-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('extract: 多语言图提取', () => {
  it('从 Python + JS 仓库提取节点和边', () => {
    const dir = makeRepo({
      'services/order_service.py': `
import os
from models.order import Order

class OrderService:
    def create(self, order: Order) -> Order:
        pass
`,
      'models/order.py': `
class Order:
    def total(self) -> float:
        return 0.0
`,
      'src/index.js': `
const { Order } = require('./models/order');
class App {
  start() {}
}
module.exports = { App };
`
    });
    const graph = buildGraph(dir);
    // 至少 3 个文件节点 + 3 个类型节点
    assert.ok(graph.stats.files >= 3, `files=${graph.stats.files}`);
    assert.ok(graph.stats.nodes >= 6, `nodes=${graph.stats.nodes}`);
    assert.ok(graph.stats.edges >= 3, `edges=${graph.stats.edges}`);
    assert.ok(graph.fingerprint.length === 16);
    assert.ok(graph.languages.includes('python'));
    assert.ok(graph.languages.includes('javascript'));
    // OrderService → Order 方法参数/返回类型边
    const typeEdges = graph.edges.filter((e) => e.type === 'method-param' || e.type === 'method-return');
    assert.ok(typeEdges.length > 0, 'should have method type edges');
  });

  it('fingerprint 相同仓库稳定', () => {
    const dir = makeRepo({
      'main.py': 'class App:\n    pass\n'
    });
    const g1 = buildGraph(dir);
    const g2 = buildGraph(dir);
    assert.equal(g1.fingerprint, g2.fingerprint);
  });

  it('extractGraphTo 写入 JSON 文件', () => {
    const dir = makeRepo({ 'main.py': 'class App:\n    pass\n' });
    const out = path.join(dir, 'out', 'graph.json');
    const g = extractGraphTo(dir, out);
    assert.ok(fs.existsSync(out));
    const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(parsed.fingerprint, g.fingerprint);
  });
});

describe('diff: 架构图差分', () => {
  it('相同仓库 diff 为空', () => {
    const dir = makeRepo({ 'main.py': 'class App:\n    pass\n' });
    const g = buildGraph(dir);
    const d = diffGraphs(g, g);
    assert.equal(d.summary.addedNodes, 0);
    assert.equal(d.summary.removedNodes, 0);
    assert.equal(d.summary.addedEdges, 0);
    assert.equal(d.summary.removedEdges, 0);
    assert.equal(d.summary.riskLevel, 'none');
  });

  it('新增类型检测', () => {
    const base = makeRepo({
      'models/order.py': 'class Order:\n    pass\n'
    });
    // head = base + 新文件
    const head = makeRepo({
      'models/order.py': 'class Order:\n    pass\n',
      'services/svc.py': 'from models.order import Order\nclass OrderService:\n    def create(self, o: Order) -> None:\n        pass\n'
    });
    const gBase = buildGraph(base);
    const gHead = buildGraph(head);
    const d = diffGraphs(gBase, gHead);
    assert.ok(d.summary.addedNodes > 0, `addedNodes=${d.summary.addedNodes}`);
    assert.ok(d.addedTypes.some((t) => t.node.kind === 'class' && t.node.name === 'OrderService'));
    assert.ok(d.summary.riskLevel !== 'none');
  });

  it('删除类型检测', () => {
    const base = makeRepo({
      'models/order.py': 'class Order:\n    pass\n',
      'models/extra.py': 'class Extra:\n    pass\n'
    });
    const head = makeRepo({
      'models/order.py': 'class Order:\n    pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    assert.ok(d.summary.removedNodes > 0);
    assert.ok(d.removedTypes.some((t) => t.node.name === 'Extra'));
  });

  it('修改方法检测', () => {
    const base = makeRepo({
      'svc.py': 'class Svc:\n    def foo(self):\n        pass\n'
    });
    const head = makeRepo({
      'svc.py': 'class Svc:\n    def foo(self):\n        pass\n    def bar(self):\n        pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    assert.ok(d.modifiedNodes.length > 0);
    const mod = d.modifiedNodes[0];
    const methodChange = mod.changes.find((c) => c.field === 'methods');
    assert.ok(methodChange, 'should detect method change');
    assert.ok(methodChange.added.includes('bar'));
  });

  it('formatDiffText 输出中文报告', () => {
    const base = makeRepo({ 'a.py': 'class A:\n    pass\n' });
    const head = makeRepo({
      'a.py': 'class A:\n    pass\n',
      'b.py': 'class B:\n    pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    const text = formatDiffText(d);
    assert.match(text, /架构变更报告/);
    assert.match(text, /汇总/);
    assert.match(text, /新增类型/);
    assert.match(text, /B/);
  });
});
