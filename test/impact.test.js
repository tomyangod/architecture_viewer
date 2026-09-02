'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeImpact, formatImpactText } = require('../lib/impact');

function file(id, name) {
  return { id: `file:${id}`, kind: 'file', name: name || id, path: id, layer: 'app', lang: 'javascript' };
}

// c.js → a.js → b.js（反向影响链：改 b 波及 a，间接波及 c）
function chainGraph() {
  return {
    nodes: [file('b.js'), file('a.js'), file('c.js')],
    edges: [
      { from: 'file:a.js', to: 'file:b.js', type: 'import' },
      { from: 'file:c.js', to: 'file:a.js', type: 'import' },
      { from: 'file:b.js', to: 'b.js#util', type: 'declared-in' } // 归属边，必须忽略
    ]
  };
}

describe('B3 架构变更增量审计（反向依赖影响面）', () => {
  test('修改节点：直接下游 + 间接下游沿 import 链反向传播', () => {
    const base = chainGraph();
    const head = chainGraph();
    const diff = {
      addedNodes: [], removedNodes: [], renamedNodes: [],
      modifiedNodes: [{ id: 'file:b.js' }]
    };
    const impact = computeImpact(diff, base, head);
    assert.equal(impact.changedCount, 1);
    assert.equal(impact.impactedCount, 2);
    const item = impact.items[0];
    assert.equal(item.id, 'file:b.js');
    assert.equal(item.label, '修改');
    assert.deepEqual(item.direct.map((d) => d.id).sort(), ['file:a.js']);
    assert.deepEqual(item.transitive.map((d) => d.id).sort(), ['file:c.js']);
  });

  test('归属边（declared-in）不计入影响面', () => {
    const base = chainGraph();
    const head = chainGraph();
    const impact = computeImpact(
      { addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [{ id: 'b.js#util' }] },
      base, head
    );
    // b.js#util 只有 declared-in 归属关系，没有架构依赖边 → 无下游
    assert.equal(impact.items.length, 0);
    assert.equal(impact.impactedCount, 0);
  });

  test('删除节点：从 base 图反查旧调用方', () => {
    const base = {
      nodes: [file('d.js'), file('e.js')],
      edges: [{ from: 'file:e.js', to: 'file:d.js', type: 'import' }]
    };
    const head = { nodes: [file('e.js')], edges: [] };
    const impact = computeImpact(
      { addedNodes: [], renamedNodes: [], modifiedNodes: [], removedNodes: [{ id: 'file:d.js' }] },
      base, head
    );
    assert.equal(impact.impactedCount, 1);
    assert.deepEqual(impact.items[0].direct.map((d) => d.id), ['file:e.js']);
    assert.equal(impact.items[0].label, '删除');
  });

  test('新增节点无调用方时不报影响面', () => {
    const base = { nodes: [], edges: [] };
    const head = {
      nodes: [file('new.js')],
      edges: []
    };
    const impact = computeImpact(
      { removedNodes: [], renamedNodes: [], modifiedNodes: [], addedNodes: [{ id: 'file:new.js' }] },
      base, head
    );
    assert.equal(impact.items.length, 0);
    assert.equal(formatImpactText(impact), '');
  });

  test('BFS 穿透被改实体集群，只报告集群边界外的下游', () => {
    // c.js → a.js → b.js；本次同时改了 a 和 b（同一次变更簇），
    // 真正被波及的是簇外的 c.js，而不是互为 seed 的 a/b。
    const base = chainGraph();
    const head = chainGraph();
    const impact = computeImpact(
      { addedNodes: [], removedNodes: [], renamedNodes: [],
        modifiedNodes: [{ id: 'file:a.js' }, { id: 'file:b.js' }] },
      base, head
    );
    assert.equal(impact.impactedCount, 1);
    const reported = new Set(impact.items.flatMap((it) => [...it.direct, ...it.transitive].map((d) => d.id)));
    assert.deepEqual([...reported], ['file:c.js']);
    const itemA = impact.items.find((it) => it.id === 'file:a.js');
    assert.deepEqual(itemA.direct.map((d) => d.id), ['file:c.js']);
    const itemB = impact.items.find((it) => it.id === 'file:b.js');
    assert.equal(itemB.direct.length, 0);
    assert.deepEqual(itemB.transitive.map((d) => d.id), ['file:c.js']);
  });

  test('重命名：base 旧名调用方 + head 新名调用方都计入', () => {
    const base = {
      nodes: [file('old.js'), file('caller1.js')],
      edges: [{ from: 'file:caller1.js', to: 'file:old.js', type: 'import' }]
    };
    const head = {
      nodes: [file('new.js'), file('caller1.js'), file('caller2.js')],
      edges: [
        { from: 'file:caller2.js', to: 'file:new.js', type: 'import' }
      ]
    };
    const impact = computeImpact(
      {
        addedNodes: [], removedNodes: [], modifiedNodes: [],
        renamedNodes: [{ from: { id: 'file:old.js' }, to: { id: 'file:new.js' } }]
      },
      base, head
    );
    const all = impact.items.flatMap((it) => [...it.direct, ...it.transitive].map((d) => d.id));
    assert.ok(all.includes('file:caller1.js'), 'base 图旧名调用方应计入');
    assert.ok(all.includes('file:caller2.js'), 'head 图新名调用方应计入');
  });

  test('formatImpactText 输出高信号摘要', () => {
    const base = chainGraph();
    const head = chainGraph();
    const impact = computeImpact(
      { addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [{ id: 'file:b.js' }] },
      base, head
    );
    const text = formatImpactText(impact);
    assert.match(text, /影响面/);
    assert.match(text, /受影响下游 2/);
    assert.match(text, /直接下游 1/);
  });
});
