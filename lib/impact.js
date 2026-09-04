'use strict';

// B3 架构变更增量审计：被改实体的反向依赖——「这次改动会波及谁」。
// 沿 wiring 边（import/extends/implements/...）反向 BFS，
// base 图（旧调用方，如删除/重命名前）与 head 图（新调用方）的反向边取并集。
const WIRING_EDGE_TYPES = new Set([
  'import', 'extends', 'implements', 'field-type', 'method-param',
  'method-return', 'component-props', 'uses', 'calls'
]);

const MAX_DEPTH = 6;
const MAX_DETAIL = 10;

function reverseIndex(graph) {
  const rev = new Map(); // id -> Set(dependentId)
  for (const e of (graph.edges || [])) {
    if (!WIRING_EDGE_TYPES.has(e.type)) continue;
    if (!rev.has(e.to)) rev.set(e.to, new Set());
    rev.get(e.to).add(e.from);
  }
  return rev;
}

function nodeIndex(graph) {
  const m = new Map();
  for (const n of (graph.nodes || [])) m.set(n.id, n);
  return m;
}

function changeLabel(change) {
  return { added: '新增', removed: '删除', modified: '修改' }[change] || '重命名';
}

function computeImpact(diff, baseGraph, headGraph) {
  const seeds = [];
  for (const n of diff.addedNodes || []) seeds.push({ id: n.id, change: 'added' });
  for (const n of diff.removedNodes || []) seeds.push({ id: n.id, change: 'removed' });
  for (const n of diff.modifiedNodes || []) seeds.push({ id: n.id, change: 'modified' });
  for (const n of diff.movedNodes || []) seeds.push({ id: n.id, change: 'moved' });
  for (const r of diff.renamedNodes || []) {
    if (r.from && r.from.id) seeds.push({ id: r.from.id, change: 'renamed-from' });
    if (r.to && r.to.id) seeds.push({ id: r.to.id, change: 'renamed-to' });
  }
  const seedIds = new Set(seeds.map((s) => s.id));

  const revBase = reverseIndex(baseGraph || {});
  const revHead = reverseIndex(headGraph || {});
  const idx = new Map([...nodeIndex(baseGraph || {}), ...nodeIndex(headGraph || {})]);

  const reverseOf = (id) => new Set([...(revBase.get(id) || []), ...(revHead.get(id) || [])]);
  const meta = (id) => {
    const n = idx.get(id);
    return n
      ? { id, name: n.name, kind: n.kind, path: n.path || n.module || '', layer: n.layer }
      : { id, name: id };
  };

  const items = [];
  for (const s of seeds) {
    const direct = new Set();
    const transitive = new Set();
    // BFS 穿透被改实体集群：seed → seed 的链路继续走，
    // 只把集群边界之外（非 seed）的节点报告为受影响下游。
    const seen = new Set([s.id]);
    let frontier = [...reverseOf(s.id)].filter((d) => d !== s.id);
    for (const d of frontier) {
      seen.add(d);
      if (!seedIds.has(d)) direct.add(d);
    }
    let depth = 1;
    while (frontier.length && depth < MAX_DEPTH) {
      const next = [];
      for (const cur of frontier) {
        for (const d of reverseOf(cur)) {
          if (seen.has(d)) continue;
          seen.add(d);
          next.push(d);
          if (!seedIds.has(d) && !direct.has(d)) transitive.add(d);
        }
      }
      frontier = next;
      depth += 1;
    }
    if (direct.size === 0 && transitive.size === 0) continue;
    items.push({
      id: s.id,
      change: s.change,
      label: changeLabel(s.change),
      node: meta(s.id),
      direct: [...direct].map(meta),
      transitive: [...transitive].map(meta)
    });
  }

  const impactedIds = new Set();
  for (const it of items) {
    it.direct.forEach((d) => impactedIds.add(d.id));
    it.transitive.forEach((d) => impactedIds.add(d.id));
  }
  return { changedCount: seedIds.size, impactedCount: impactedIds.size, items };
}

function formatImpactText(impact) {
  if (!impact || impact.items.length === 0) return '';
  const lines = [];
  lines.push('--- 影响面（反向依赖：谁会被波及） ---');
  lines.push(`  被改实体 ${impact.changedCount} 个，受影响下游 ${impact.impactedCount} 个`);
  for (const it of impact.items.slice(0, MAX_DETAIL)) {
    const name = it.node.name || it.id;
    const direct = it.direct.slice(0, 5).map((d) => d.name || d.id).join(', ');
    lines.push(
      `  • [${it.label}] ${name} → 直接下游 ${it.direct.length}` +
      (it.direct.length ? `: ${direct}` : '') +
      `，间接 ${it.transitive.length}`
    );
  }
  if (impact.items.length > MAX_DETAIL) {
    lines.push(`  …另有 ${impact.items.length - MAX_DETAIL} 个被改实体，--json 查看全部`);
  }
  return lines.join('\n');
}

/**
 * 多仓影响面汇总：聚合各仓 impact 为统一摘要。
 * @param {Array} repoResults — reportRepo() 返回数组，已含 impact 字段
 * @returns {object} { repos, totalChanged, totalImpacted }
 */
function aggregateImpact(repoResults) {
  const repos = [];
  let totalChanged = 0;
  let totalImpacted = 0;
  for (const r of repoResults) {
    const imp = r.impact;
    if (!imp || !imp.items) {
      repos.push({ name: r.name, status: r.status, changedCount: 0, impactedCount: 0, items: [] });
      continue;
    }
    totalChanged += imp.changedCount;
    totalImpacted += imp.impactedCount;
    repos.push({
      name: r.name,
      status: r.status,
      changedCount: imp.changedCount,
      impactedCount: imp.impactedCount,
      items: imp.items.slice(0, MAX_DETAIL).map((it) => ({
        label: it.label,
        name: it.node.name || it.id,
        kind: it.node.kind,
        path: it.node.path || '',
        direct: it.direct.length,
        transitive: it.transitive.length,
        directNames: it.direct.slice(0, 5).map((d) => d.name || d.id)
      }))
    });
  }
  return { repos, totalChanged, totalImpacted };
}

module.exports = { computeImpact, formatImpactText, aggregateImpact, reverseIndex, WIRING_EDGE_TYPES };
