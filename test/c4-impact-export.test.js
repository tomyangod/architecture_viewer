'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeImpact, aggregateImpact } = require('../lib/impact');

function node(id, name) {
  return { id, kind: 'file', name: name || id, path: id, layer: 'service' };
}

describe('C4 影响面报告导出', () => {
  describe('impact 独立命令（computeImpact 对任意 base/head 图）', () => {
    test('两版本对比，无变更时 impact 为空', () => {
      const g = { nodes: [node('a.js'), node('b.js')], edges: [{ from: 'a.js', to: 'b.js', type: 'import' }] };
      const diff = { addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [] };
      const impact = computeImpact(diff, g, g);
      assert.equal(impact.items.length, 0);
      assert.equal(impact.changedCount, 0);
    });

    test('修改节点时，沿反向边找到直接和间接下游', () => {
      // c → a → b：改 b 波及 a（直接）、c（间接）
      const base = {
        nodes: [node('b.js'), node('a.js'), node('c.js')],
        edges: [
          { from: 'a.js', to: 'b.js', type: 'import' },
          { from: 'c.js', to: 'a.js', type: 'import' }
        ]
      };
      const diff = { addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [{ id: 'b.js' }] };
      const impact = computeImpact(diff, base, base);
      assert.equal(impact.items.length, 1);
      assert.equal(impact.items[0].direct.length, 1);
      assert.equal(impact.items[0].direct[0].id, 'a.js');
      assert.equal(impact.items[0].transitive.length, 1);
    });

    test('JSON 输出格式包含 summary 和 impact', () => {
      // 这里只验证数据结构可被 JSON 序列化
      const base = { nodes: [node('b.js'), node('a.js')], edges: [{ from: 'a.js', to: 'b.js', type: 'import' }] };
      const diff = { addedNodes: [], removedNodes: [], renamedNodes: [], modifiedNodes: [{ id: 'b.js' }] };
      const impact = computeImpact(diff, base, base);
      const json = JSON.stringify({ summary: { addedNodes: 0 }, impact });
      const parsed = JSON.parse(json);
      assert.ok(parsed.impact.items);
      assert.equal(parsed.impact.changedCount, 1);
    });
  });

  describe('aggregateImpact 多仓汇总', () => {
    test('聚合多个仓的影响面数据', () => {
      const results = [
        {
          name: 'repo-a',
          status: 'ok',
          impact: {
            changedCount: 2,
            impactedCount: 3,
            items: [
              { label: '修改', node: { name: 'util.js', kind: 'file', path: 'util.js' }, direct: [{ name: 'core.js', id: 'core.js' }], transitive: [{ name: 'app.js', id: 'app.js' }] }
            ]
          }
        },
        {
          name: 'repo-b',
          status: 'ok',
          impact: {
            changedCount: 1,
            impactedCount: 0,
            items: []
          }
        },
        {
          name: 'repo-c',
          status: 'no-baseline',
          impact: null
        }
      ];
      const agg = aggregateImpact(results);
      assert.equal(agg.totalChanged, 3);
      assert.equal(agg.totalImpacted, 3);
      assert.equal(agg.repos.length, 3);
      assert.equal(agg.repos[0].name, 'repo-a');
      assert.equal(agg.repos[0].changedCount, 2);
      assert.equal(agg.repos[0].items[0].direct, 1);
      assert.equal(agg.repos[0].items[0].directNames[0], 'core.js');
      assert.equal(agg.repos[1].changedCount, 1);
      assert.equal(agg.repos[1].impactedCount, 0);
      assert.equal(agg.repos[2].status, 'no-baseline');
      assert.equal(agg.repos[2].changedCount, 0);
    });

    test('全部仓无变更时汇总为 0', () => {
      const results = [
        { name: 'r1', status: 'ok', impact: { changedCount: 0, impactedCount: 0, items: [] } },
        { name: 'r2', status: 'ok', impact: { changedCount: 0, impactedCount: 0, items: [] } }
      ];
      const agg = aggregateImpact(results);
      assert.equal(agg.totalChanged, 0);
      assert.equal(agg.totalImpacted, 0);
    });

    test('错误仓不影响其他仓聚合', () => {
      const results = [
        { name: 'err', status: 'error', error: 'boom', impact: null },
        {
          name: 'ok',
          status: 'ok',
          impact: { changedCount: 1, impactedCount: 2, items: [{ label: '修改', node: { name: 'x' }, direct: [{ name: 'y' }], transitive: [{ name: 'z' }] }] }
        }
      ];
      const agg = aggregateImpact(results);
      assert.equal(agg.totalChanged, 1);
      assert.equal(agg.totalImpacted, 2);
      assert.equal(agg.repos[0].status, 'error');
      assert.equal(agg.repos[0].changedCount, 0);
    });
  });
});
