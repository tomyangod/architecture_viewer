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

  // --- Rename / move detection ---
  // Match removed→added pairs by same file path + same kind + name similarity.
  // Matched pairs are moved to renamedNodes and removed from added/removed lists.
  const renamedNodes = [];
  const matchedRemove = new Set();
  const matchedAdd = new Set();

  for (let i = 0; i < removedNodes.length; i++) {
    if (matchedRemove.has(i)) continue;
    const r = removedNodes[i].node;
    for (let j = 0; j < addedNodes.length; j++) {
      if (matchedAdd.has(j)) continue;
      const a = addedNodes[j].node;
      if (r.kind !== a.kind) continue;
      const rPath = r.path || r.module || '';
      const aPath = a.path || a.module || '';
      if (!rPath || !aPath || rPath !== aPath) continue;
      if (!isRenamePair(r.name, a.name)) continue;
      renamedNodes.push({
        kind: r.kind,
        oldName: r.name,
        newName: a.name,
        path: rPath,
        from: r,
        to: a
      });
      matchedRemove.add(i);
      matchedAdd.add(j);
      break;
    }
  }

  // Filter out matched entries
  const finalAddedNodes = addedNodes.filter((_, i) => !matchedAdd.has(i));
  const finalRemovedNodes = removedNodes.filter((_, i) => !matchedRemove.has(i));

  // --- File-level modification detection ---
  // For files that exist in both base and head, detect added/removed child
  // entities (functions, classes) by comparing child entity sets.
  const baseChildrenByFile = new Map(); // file path → Set of child entity ids
  const headChildrenByFile = new Map();
  for (const n of base.nodes) {
    if (n.kind === 'file' || n.kind === 'module') continue;
    const fp = n.path || n.module || '';
    if (!fp) continue;
    if (!baseChildrenByFile.has(fp)) baseChildrenByFile.set(fp, new Set());
    baseChildrenByFile.get(fp).add(n.id);
  }
  for (const n of head.nodes) {
    if (n.kind === 'file' || n.kind === 'module') continue;
    const fp = n.path || n.module || '';
    if (!fp) continue;
    if (!headChildrenByFile.has(fp)) headChildrenByFile.set(fp, new Set());
    headChildrenByFile.get(fp).add(n.id);
  }

  // Find files present in both base and head with child entity changes
  for (const [fp, baseChildIds] of baseChildrenByFile) {
    const headChildIds = headChildrenByFile.get(fp);
    if (!headChildIds) continue; // file removed
    const added = [...headChildIds].filter(id => !baseChildIds.has(id));
    const removed = [...baseChildIds].filter(id => !headChildIds.has(id));
    if (added.length === 0 && removed.length === 0) continue;

    // Find the file node for naming
    const fileId = 'file:' + fp;
    const bFile = baseNodes.get(fileId);
    const hFile = headNodes.get(fileId);

    // Don't duplicate if already in modifiedNodes via methods array
    const existing = modifiedNodes.find(m => m.id === fileId);
    if (existing) {
      // Enrich with child entity info if not already there
      if (!existing.changes.some(c => c.field === 'childEntities')) {
        existing.changes.push({ field: 'childEntities', added, removed });
      }
    } else {
      modifiedNodes.push({
        id: fileId,
        name: (hFile || bFile || {}).name || fp,
        path: fp,
        changes: [{ field: 'childEntities', added, removed }],
        from: bFile || { id: fileId, path: fp },
        to: hFile || { id: fileId, path: fp }
      });
    }
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
  const addedTypes = finalAddedNodes.filter((n) => typeKinds.includes(n.node.kind));
  const removedTypes = finalRemovedNodes.filter((n) => typeKinds.includes(n.node.kind));

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
    addedNodes: finalAddedNodes.length,
    removedNodes: finalRemovedNodes.length,
    modifiedNodes: modifiedNodes.length,
    renamedNodes: renamedNodes.length,
    addedEdges: addedEdges.length,
    removedEdges: removedEdges.length,
    addedTypes: addedTypes.length,
    removedTypes: removedTypes.length,
    addedPackages: addedPackages.length,
    removedPackages: removedPackages.length,
    addedExternalDeps: addedExternalDeps.length,
    removedExternalDeps: removedExternalDeps.length,
    violations: violations.length,
    totalChanges: finalAddedNodes.length + finalRemovedNodes.length + modifiedNodes.length
      + renamedNodes.length + addedEdges.length + removedEdges.length + addedExtDepsCount(addedExternalDeps, removedExternalDeps)
  };

  summary.riskLevel = assessRisk(summary);

  return {
    base: { fingerprint: base.fingerprint, root: base.root, stats: base.stats },
    head: { fingerprint: head.fingerprint, root: head.root, stats: head.stats },
    summary,
    addedNodes: finalAddedNodes, removedNodes: finalRemovedNodes, modifiedNodes,
    renamedNodes,
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

/**
 * Determine if two names are similar enough to be a rename.
 * Heuristic: common prefix >= 3 chars AND one name is not a substring of the other
 * (to avoid matching `get` → `getAll`), OR Levenshtein distance <= 2 for short names.
 */
function isRenamePair(nameA, nameB) {
  if (!nameA || !nameB) return false;
  if (nameA === nameB) return false; // identical → not a rename
  // Don't match if one is a substring of the other (likely an overload, not rename)
  if (nameA.includes(nameB) || nameB.includes(nameA)) return false;
  // Common prefix
  let prefix = 0;
  const minLen = Math.min(nameA.length, nameB.length);
  while (prefix < minLen && nameA[prefix] === nameB[prefix]) prefix++;
  // Require at least 3 chars common prefix (or half the shorter name)
  if (prefix >= 3 || prefix >= minLen / 2) return true;
  // Levenshtein fallback for short names
  if (minLen <= 6 && levenshtein(nameA, nameB) <= 2) return true;
  return false;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,        // deletion
        dp[j - 1] + 1,    // insertion
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)  // substitution
      );
      prev = tmp;
    }
  }
  return dp[n];
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

function formatDiffText(diff, opts) {
  const showAll = !!(opts && opts.all);
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
  if (s.renamedNodes > 0) lines.push(`  重命名:   ${s.renamedNodes}`);
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

  if (diff.renamedNodes && diff.renamedNodes.length > 0) {
    lines.push('--- 重命名 ---');
    for (const r of diff.renamedNodes)
      lines.push(`  ~ [${r.kind}] ${r.oldName} → ${r.newName} (${r.path})`);
    lines.push('');
  }

  if (diff.modifiedNodes.length > 0) {
    lines.push('--- 修改文件/类型 ---');
    for (const m of diff.modifiedNodes) {
      for (const c of m.changes) {
        if (c.field === 'methods') {
          if (c.added && c.added.length > 0) lines.push(`  ~ ${m.id} +method: ${c.added.join(', ')}`);
          if (c.removed && c.removed.length > 0) lines.push(`  ~ ${m.id} -method: ${c.removed.join(', ')}`);
        } else if (c.field === 'childEntities') {
          if (c.added && c.added.length > 0) lines.push(`  ~ ${m.path || m.id} +${c.added.length} entities: ${c.added.slice(0,5).join(', ')}${c.added.length > 5 ? ' ...' : ''}`);
          if (c.removed && c.removed.length > 0) lines.push(`  ~ ${m.path || m.id} -${c.removed.length} entities: ${c.removed.slice(0,5).join(', ')}${c.removed.length > 5 ? ' ...' : ''}`);
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

  const depTypes = ['import', 'extends', 'implements', 'field-type', 'component-props'];
  const attachTypes = ['declared-in', 'defined-in'];

  if (diff.addedEdges.length > 0) {
    lines.push('--- 新增关系 ---');
    // High-signal: import / heritage / cross-entity dependencies.
    // Declared-in / defined-in (function belongs to file) are attachment
    // bookkeeping, not architecture changes — fold them into a count
    // unless --all is requested.
    const depEdges = diff.addedEdges.filter((e) => depTypes.includes(e.type));
    const attachEdges = diff.addedEdges.filter((e) => attachTypes.includes(e.type));
    for (const e of depEdges.slice(0, 30))
      lines.push(`  + ${e.from} --${e.type}--> ${e.to}`);
    if (depEdges.length > 30) lines.push(`  ... 还有 ${depEdges.length - 30} 条依赖关系`);
    if (attachEdges.length > 0) {
      if (showAll) {
        for (const e of attachEdges.slice(0, 30))
          lines.push(`  + ${e.from} --${e.type}--> ${e.to}`);
        if (attachEdges.length > 30) lines.push(`  ... 还有 ${attachEdges.length - 30} 条归属关系`);
      } else {
        lines.push(`  (另有 ${attachEdges.length} 条归属关系，--all 查看)`);
      }
    }
    lines.push('');
  }

  if (diff.removedEdges.length > 0) {
    lines.push('--- 删除关系 ---');
    const depEdges = diff.removedEdges.filter((e) => depTypes.includes(e.type));
    const attachEdges = diff.removedEdges.filter((e) => attachTypes.includes(e.type));
    for (const e of depEdges.slice(0, 30))
      lines.push(`  - ${e.from} --${e.type}--> ${e.to}`);
    if (depEdges.length > 30) lines.push(`  ... 还有 ${depEdges.length - 30} 条依赖关系`);
    if (attachEdges.length > 0) {
      if (showAll) {
        for (const e of attachEdges.slice(0, 30))
          lines.push(`  - ${e.from} --${e.type}--> ${e.to}`);
        if (attachEdges.length > 30) lines.push(`  ... 还有 ${attachEdges.length - 30} 条归属关系`);
      } else {
        lines.push(`  (另有 ${attachEdges.length} 条归属关系，--all 查看)`);
      }
    }
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
