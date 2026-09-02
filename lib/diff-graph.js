'use strict';

function diffGraphs(base, head) {
  const baseNodes = new Map(base.nodes.map((n) => [n.id, n]));
  const headNodes = new Map(head.nodes.map((n) => [n.id, n]));

  const baseEdges = new Map();
  for (const e of base.edges) baseEdges.set(edgeKey(e), e);
  const headEdges = new Map();
  for (const e of head.edges) headEdges.set(edgeKey(e), e);

  const addedNodes = [];
  const removedNodes = [];
  const modifiedNodes = [];

  for (const [id, hNode] of headNodes) {
    if (!baseNodes.has(id)) {
      addedNodes.push({ id, node: hNode });
    } else {
      const bNode = baseNodes.get(id);
      const changes = [];
      if (bNode.name !== hNode.name)
        changes.push({ field: 'name', from: bNode.name, to: hNode.name });
      if (bNode.kind !== hNode.kind)
        changes.push({ field: 'kind', from: bNode.kind, to: hNode.kind });
      if (bNode.path !== hNode.path)
        changes.push({ field: 'path', from: bNode.path, to: hNode.path });
      if (JSON.stringify(bNode.modifiers || []) !== JSON.stringify(hNode.modifiers || []))
        changes.push({ field: 'modifiers', from: bNode.modifiers || [], to: hNode.modifiers || [] });
      const bMethods = bNode.methods || [];
      const hMethods = hNode.methods || [];
      if (JSON.stringify(bMethods) !== JSON.stringify(hMethods)) {
        const added = hMethods.filter((m) => !bMethods.includes(m));
        const removed = bMethods.filter((m) => !hMethods.includes(m));
        changes.push({ field: 'methods', added, removed, from: bMethods, to: hMethods });
      }
      if (changes.length > 0)
        modifiedNodes.push({ id, changes, from: bNode, to: hNode });
    }
  }

  for (const [id, bNode] of baseNodes) {
    if (!headNodes.has(id)) removedNodes.push({ id, node: bNode });
  }

  const addedEdges = [];
  const removedEdges = [];

  for (const [key, hEdge] of headEdges) {
    if (!baseEdges.has(key)) addedEdges.push(Object.assign({ _key: key }, hEdge));
  }
  for (const [key, bEdge] of baseEdges) {
    if (!headEdges.has(key)) removedEdges.push(Object.assign({ _key: key }, bEdge));
  }

  const basePkgs = groupByPackage(base.nodes);
  const headPkgs = groupByPackage(head.nodes);
  const addedPackages = [];
  const removedPackages = [];
  for (const [pkg, count] of headPkgs) {
    if (!basePkgs.has(pkg)) addedPackages.push({ package: pkg, count });
  }
  for (const [pkg, count] of basePkgs) {
    if (!headPkgs.has(pkg)) removedPackages.push({ package: pkg, count });
  }

  const typeKinds = ['class', 'interface', 'enum', 'record', 'annotation', 'function', 'type_alias', 'component'];
  const addedTypes = addedNodes.filter((n) => typeKinds.includes(n.node.kind));
  const removedTypes = removedNodes.filter((n) => typeKinds.includes(n.node.kind));

  const baseExt = new Set();
  for (const n of base.nodes) {
    if (n.kind === 'external' || n.kind === 'external-package') baseExt.add(n.id);
  }
  const headExt = new Set();
  for (const n of head.nodes) {
    if (n.kind === 'external' || n.kind === 'external-package') headExt.add(n.id);
  }
  const addedExternalDeps = [...headExt].filter((d) => !baseExt.has(d)).map((id) => ({
    id, name: headNodes.get(id) ? headNodes.get(id).name : id
  }));
  const removedExternalDeps = [...baseExt].filter((d) => !headExt.has(d)).map((id) => ({
    id, name: baseNodes.get(id) ? baseNodes.get(id).name : id
  }));

  const violations = [];
  const seenViolations = new Set();
  for (const e of addedEdges) {
    const edge = e;
    // Architectural dependency edges between two code entities/files.
    if (!['import', 'extends', 'implements', 'method-param', 'method-return', 'field-type', 'component-props'].includes(edge.type)) continue;
    const fromNode = headNodes.get(edge.from);
    const toNode = headNodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    // Use explicit layer when present (file/entity nodes); fall back to path inference.
    const fl = fromNode.layer || inferLayer(fromNode.path || fromNode.module || fromNode.fqn);
    const tl = toNode.layer || inferLayer(toNode.path || toNode.module || toNode.fqn);
    if (fl && tl && fl !== tl && isReverseDependency(fl, tl)) {
      const key = fl + '->' + tl + ':' + edge.from + '->' + edge.to;
      if (seenViolations.has(key)) continue;
      seenViolations.add(key);
      violations.push({
        type: 'cross-layer',
        from: edge.from, to: edge.to,
        edgeType: edge.type,
        fromLayer: fl, toLayer: tl,
        file: edge.file, line: edge.line,
        evidence: edge.evidence
      });
    }
  }

  const summary = {
    addedNodes: addedNodes.length,
    removedNodes: removedNodes.length,
    modifiedNodes: modifiedNodes.length,
    addedEdges: addedEdges.length,
    removedEdges: removedEdges.length,
    addedTypes: addedTypes.length,
    removedTypes: removedTypes.length,
    addedPackages: addedPackages.length,
    removedPackages: removedPackages.length,
    addedExternalDeps: addedExternalDeps.length,
    removedExternalDeps: removedExternalDeps.length,
    violations: violations.length,
    totalChanges: addedNodes.length + removedNodes.length + modifiedNodes.length
      + addedEdges.length + removedEdges.length + addedExtDepsCount(addedExternalDeps, removedExternalDeps)
  };

  summary.riskLevel = assessRisk(summary);

  return {
    base: { fingerprint: base.fingerprint, root: base.root, stats: base.stats },
    head: { fingerprint: head.fingerprint, root: head.root, stats: head.stats },
    summary,
    addedNodes, removedNodes, modifiedNodes,
    addedEdges, removedEdges,
    addedPackages, removedPackages,
    addedTypes, removedTypes,
    addedExternalDeps, removedExternalDeps,
    violations
  };
}

function addedExtDepsCount(added, removed) {
  return added.length + removed.length;
}

function edgeKey(e) {
  return e.from + '|' + e.to + '|' + e.type;
}

function groupByPackage(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    let pkg = n.package || n.module || n.fqn || '(default)';
    // For file/entity nodes with a path, group by top-level source directory.
    if (n.path) {
      const parts = n.path.split(/[\\/]/);
      // Drop leading 'src' and filename to get the feature/package folder.
      const dirs = parts.slice(0, -1).filter((p) => p && p !== 'src' && p !== 'lib');
      pkg = dirs.length ? dirs.join('/') : '(root)';
    }
    if (!groups.has(pkg)) groups.set(pkg, 0);
    groups.set(pkg, groups.get(pkg) + 1);
  }
  return groups;
}

function inferLayer(pkgOrPath) {
  if (!pkgOrPath) return null;
  const p = String(pkgOrPath).toLowerCase();
  if (/\/components?|\/ui\/|\/widgets?|\/screens?|\/containers?|\/layouts?/.test(p)) return 'component';
  if (/controller|resource|\/api\/|\/web\/|\/routes?|handler|\/page|\/view/.test(p)) return 'controller';
  if (/service|usecase|facade|business|\/hooks?|\/stores?|\/composables?/.test(p)) return 'service';
  if (/model|entity|domain|aggregate|\/core/.test(p)) return 'domain';
  if (/repository|dao|persist|storage|\/db|mapper/.test(p)) return 'storage';
  if (/dto|\/vo|pojo|request|response|payload|schema|\/types?|\/interfaces?|\/props?/.test(p)) return 'dto';
  if (/config|security|auth|settings|properties/.test(p)) return 'config';
  if (/util|common|helper|shared|\/lib/.test(p)) return 'util';
  return null;
}

// Higher rank = higher architectural level. A reverse dependency (violation)
// is a lower-rank layer depending on a higher-rank layer.
var LAYER_RANK = { domain: 0, util: 0, dto: 1, storage: 1, config: 2, service: 3, controller: 4, component: 5 };

function isReverseDependency(fromLayer, toLayer) {
  var fromRank = LAYER_RANK[fromLayer];
  var toRank = LAYER_RANK[toLayer];
  if (fromRank == null || toRank == null) return false;
  // Only flag when a lower layer references a higher layer
  return fromRank < toRank;
}

function assessRisk(s) {
  const score = s.addedTypes * 2 + s.removedTypes * 3
    + s.addedExternalDeps * 2 + s.removedExternalDeps * 1
    + s.violations * 5 + s.addedPackages + s.removedPackages;
  if (score === 0) return 'none';
  if (score <= 3) return 'low';
  if (score <= 8) return 'medium';
  return 'high';
}

function formatDiffText(diff) {
  const lines = [];
  const s = diff.summary;

  lines.push('=== 架构变更报告 ===');
  lines.push('');
  lines.push(`Base: ${diff.base.root} (fingerprint: ${diff.base.fingerprint})`);
  lines.push(`Head: ${diff.head.root} (fingerprint: ${diff.head.fingerprint})`);
  lines.push('');
  lines.push('--- 汇总 ---');
  lines.push(`  风险等级: ${s.riskLevel.toUpperCase()}`);
  lines.push(`  节点变化: +${s.addedNodes} -${s.removedNodes} ~${s.modifiedNodes}`);
  lines.push(`  边变化:   +${s.addedEdges} -${s.removedEdges}`);
  lines.push(`  类型变化: +${s.addedTypes} -${s.removedTypes}`);
  lines.push(`  包变化:   +${s.addedPackages} -${s.removedPackages}`);
  lines.push(`  外部依赖: +${s.addedExternalDeps} -${s.removedExternalDeps}`);
  if (s.violations > 0) lines.push(`  ⚠ 分层违规: ${s.violations}`);
  lines.push('');

  if (diff.addedTypes.length > 0) {
    lines.push('--- 新增类型 ---');
    for (const t of diff.addedTypes)
      lines.push(`  + [${t.node.kind}] ${t.node.id} (${t.node.path})`);
    lines.push('');
  }

  if (diff.removedTypes.length > 0) {
    lines.push('--- 删除类型 ---');
    for (const t of diff.removedTypes)
      lines.push(`  - [${t.node.kind}] ${t.node.id} (${t.node.path})`);
    lines.push('');
  }

  if (diff.modifiedNodes.length > 0) {
    lines.push('--- 修改类型 ---');
    for (const m of diff.modifiedNodes) {
      for (const c of m.changes) {
        if (c.field === 'methods') {
          if (c.added && c.added.length > 0) lines.push(`  ~ ${m.id} +method: ${c.added.join(', ')}`);
          if (c.removed && c.removed.length > 0) lines.push(`  ~ ${m.id} -method: ${c.removed.join(', ')}`);
        } else {
          lines.push(`  ~ ${m.id} ${c.field}: ${c.from} → ${c.to}`);
        }
      }
    }
    lines.push('');
  }

  if (diff.addedExternalDeps.length > 0) {
    lines.push('--- 新增外部依赖 ---');
    for (const d of diff.addedExternalDeps) lines.push(`  + ${d.id}`);
    lines.push('');
  }

  if (diff.removedExternalDeps.length > 0) {
    lines.push('--- 移除外部依赖 ---');
    for (const d of diff.removedExternalDeps) lines.push(`  - ${d.id}`);
    lines.push('');
  }

  if (diff.addedEdges.length > 0) {
    lines.push('--- 新增关系 ---');
    const interesting = diff.addedEdges.filter((e) =>
      ['import', 'extends', 'implements', 'field-type', 'method-return', 'method-param', 'component-props'].includes(e.type));
    for (const e of interesting.slice(0, 30))
      lines.push(`  + ${e.from} --${e.type}--> ${e.to}`);
    if (interesting.length > 30) lines.push(`  ... 还有 ${interesting.length - 30} 条`);
    lines.push('');
  }

  if (diff.removedEdges.length > 0) {
    lines.push('--- 删除关系 ---');
    const interesting = diff.removedEdges.filter((e) =>
      ['import', 'extends', 'implements', 'field-type', 'method-return', 'method-param', 'component-props'].includes(e.type));
    for (const e of interesting.slice(0, 30))
      lines.push(`  - ${e.from} --${e.type}--> ${e.to}`);
    if (interesting.length > 30) lines.push(`  ... 还有 ${interesting.length - 30} 条`);
    lines.push('');
  }

  if (diff.violations.length > 0) {
    lines.push('--- ⚠ 分层违规 ---');
    for (const v of diff.violations)
      lines.push(`  ⚠ ${v.fromLayer} → ${v.toLayer}: ${v.from} --${v.edgeType}--> ${v.to}`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { diffGraphs, formatDiffText, edgeKey, assessRisk, inferLayer };
