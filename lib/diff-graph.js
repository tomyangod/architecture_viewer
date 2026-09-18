'use strict';
const { compareSourceContentHashes } = require('./source-content');

const { diffImpls, formatImplDiffText } = require('./impl-surface');
const { isCallSurfaceNode, isCallSurfaceEdge } = require('./extract/call-graph');
const { hasSignatureData } = require('./extract/signature');
const { diffBehaviorFingerprints, formatBehaviorDiffText } = require('./extract/behavior-fingerprint');

/**
 * Diff two architecture graphs.
 *
 * Classification (inspired by Archify delta; adapted to code graphs):
 *  - added / removed / renamed — identity changes
 *  - modified (changed) — semantic fields: name, kind, methods, modifiers, childEntities
 *  - moved — same id, only ownership/placement fields: path and/or layer
 *  - rerouted — same from→to endpoints, edge type changed (e.g. implements→import)
 *
 * Field equality uses a canonical form (sorted keys / sorted arrays) so
 * order-only noise does not create false modified entries.
 */

/** Canonical JSON for equality: objects key-sorted, arrays of primitives sorted. */
function canonical(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    // Sort only arrays of primitives / identical-shape scalars — preserve object order
    // by sorting on canonical string so [a,b] === [b,a] for string lists (methods).
    if (value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
      items.sort();
    }
    return '[' + items.join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function canonicalEqual(a, b) {
  return canonical(a) === canonical(b);
}

const SEMANTIC_NODE_FIELDS = ['name', 'kind', 'modifiers', 'methods', 'signature'];
const MOVE_NODE_FIELDS = ['path', 'layer'];

/** High-signal architecture edges shown on HTML cards / Delta. Attachment
 *  (declared-in / defined-in) and external uses are counted separately. */
const ARCH_EDGE_TYPES = ['import', 'extends', 'implements', 'field-type', 'method-param', 'method-return', 'component-props', 'di-registered'];

function isArchitecturalEdge(e) {
  return !!(e && ARCH_EDGE_TYPES.includes(e.type));
}

function countArchitecturalEdges(edges) {
  return (edges || []).filter(isArchitecturalEdge).length;
}

function collectNodeFieldChanges(bNode, hNode) {
  const changes = [];
  if (bNode.name !== hNode.name)
    changes.push({ field: 'name', from: bNode.name, to: hNode.name, group: 'semantic' });
  if (bNode.kind !== hNode.kind)
    changes.push({ field: 'kind', from: bNode.kind, to: hNode.kind, group: 'semantic' });
  if (bNode.path !== hNode.path)
    changes.push({ field: 'path', from: bNode.path, to: hNode.path, group: 'move' });
  if ((bNode.layer || null) !== (hNode.layer || null))
    changes.push({ field: 'layer', from: bNode.layer || null, to: hNode.layer || null, group: 'move' });
  if (!canonicalEqual(bNode.modifiers || [], hNode.modifiers || []))
    changes.push({ field: 'modifiers', from: bNode.modifiers || [], to: hNode.modifiers || [], group: 'semantic' });
  const bMethods = bNode.methods || [];
  const hMethods = hNode.methods || [];
  if (!canonicalEqual(bMethods, hMethods)) {
    const added = hMethods.filter((m) => !bMethods.includes(m));
    const removed = bMethods.filter((m) => !hMethods.includes(m));
    changes.push({ field: 'methods', added, removed, from: bMethods, to: hMethods, group: 'semantic' });
  }
  const bSig = bNode.signature;
  const hSig = hNode.signature;
  // Old baselines have no signature — upgrade is not a semantic change.
  if (hasSignatureData(bSig) && hasSignatureData(hSig) && !canonicalEqual(bSig, hSig)) {
    if (bSig.paramCount !== hSig.paramCount) {
      changes.push({ field: 'params', from: bSig.paramCount, to: hSig.paramCount, group: 'semantic' });
    }
    if (!canonicalEqual(bSig.paramTypes || [], hSig.paramTypes || [])) {
      changes.push({ field: 'paramTypes', from: bSig.paramTypes || [], to: hSig.paramTypes || [], group: 'semantic' });
    }
    if (!canonicalEqual(bSig.returnTypes || [], hSig.returnTypes || [])) {
      changes.push({ field: 'returnTypes', from: bSig.returnTypes || [], to: hSig.returnTypes || [], group: 'semantic' });
    }
    if ((bSig.optionalParams || 0) !== (hSig.optionalParams || 0)) {
      changes.push({ field: 'optionalParams', from: bSig.optionalParams || 0, to: hSig.optionalParams || 0, group: 'semantic' });
    }
    if (!canonicalEqual(bSig.methods || [], hSig.methods || [])) {
      changes.push({ field: 'signature', from: bSig, to: hSig, group: 'semantic' });
    } else if (!changes.some((c) => ['params', 'paramTypes', 'returnTypes', 'optionalParams'].includes(c.field))) {
      changes.push({ field: 'signature', from: bSig, to: hSig, group: 'semantic' });
    }
  }
  // Old baselines have no enumValues — upgrade is not a semantic change.
  if (Array.isArray(bNode.enumValues) && Array.isArray(hNode.enumValues)
    && !canonicalEqual(bNode.enumValues, hNode.enumValues)) {
    const added = hNode.enumValues.filter((v) => !bNode.enumValues.includes(v));
    const removed = bNode.enumValues.filter((v) => !hNode.enumValues.includes(v));
    changes.push({
      field: 'enumValues',
      added,
      removed,
      from: bNode.enumValues,
      to: hNode.enumValues,
      group: 'semantic'
    });
  }
  return changes;
}

function classifyNodeChanges(changes) {
  const hasSemantic = changes.some((c) => c.group === 'semantic' || c.field === 'childEntities');
  const hasMove = changes.some((c) => c.group === 'move');
  if (hasSemantic) return 'modified';
  if (hasMove) return 'moved';
  return 'same';
}

function diffGraphs(base, head) {
  const baseNodes = new Map(base.nodes.filter((n) => !isCallSurfaceNode(n)).map((n) => [n.id, n]));
  const headNodes = new Map(head.nodes.filter((n) => !isCallSurfaceNode(n)).map((n) => [n.id, n]));

  const baseEdges = new Map();
  for (const e of base.edges) {
    if (!isCallSurfaceEdge(e)) baseEdges.set(edgeKey(e), e);
  }
  const headEdges = new Map();
  for (const e of head.edges) {
    if (!isCallSurfaceEdge(e)) headEdges.set(edgeKey(e), e);
  }

  const addedNodes = [];
  const removedNodes = [];
  const modifiedNodes = [];
  const movedNodes = [];

  for (const [id, hNode] of headNodes) {
    if (!baseNodes.has(id)) {
      addedNodes.push({ id, node: hNode });
    } else {
      const bNode = baseNodes.get(id);
      const changes = collectNodeFieldChanges(bNode, hNode);
      const kind = classifyNodeChanges(changes);
      if (kind === 'modified')
        modifiedNodes.push({ id, changes, from: bNode, to: hNode });
      else if (kind === 'moved')
        movedNodes.push({ id, changes, from: bNode, to: hNode });
    }
  }

  for (const [id, bNode] of baseNodes) {
    if (!headNodes.has(id)) removedNodes.push({ id, node: bNode });
  }

  // --- Rename / move detection ---
  // Two pair modes:
  //   1. rename: same file path + same kind + name similarity (symbol renamed in place)
  //   2. move:   different path + same file basename + same kind + exact same name
  //              (file moved to another directory; child entities move with it)
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
      if (!rPath || !aPath) continue;
      let moved = false;
      if (rPath === aPath) {
        // Rename in place: fuzzy name match
        if (!isRenamePair(r.name, a.name)) continue;
      } else {
        // Cross-directory move: exact name + same file basename (strict, no fuzzy)
        if (r.name !== a.name) continue;
        if (baseName(rPath) !== baseName(aPath)) continue;
        moved = true;
      }
      renamedNodes.push({
        kind: r.kind,
        oldName: r.name,
        newName: a.name,
        path: moved ? aPath : rPath,
        fromPath: rPath,
        toPath: aPath,
        moved,
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
        existing.changes.push({ field: 'childEntities', added, removed, group: 'semantic' });
      }
    } else {
      // If previously classified as moved (path/layer only), promote to modified
      const movedIdx = movedNodes.findIndex((m) => m.id === fileId);
      if (movedIdx >= 0) {
        const m = movedNodes.splice(movedIdx, 1)[0];
        m.changes.push({ field: 'childEntities', added, removed, group: 'semantic' });
        modifiedNodes.push(m);
      } else {
        modifiedNodes.push({
          id: fileId,
          name: (hFile || bFile || {}).name || fp,
          path: fp,
          changes: [{ field: 'childEntities', added, removed, group: 'semantic' }],
          from: bFile || { id: fileId, path: fp },
          to: hFile || { id: fileId, path: fp }
        });
      }
    }
  }

  let addedEdges = [];
  let removedEdges = [];

  for (const [key, hEdge] of headEdges) {
    if (!baseEdges.has(key)) addedEdges.push(Object.assign({ _key: key }, hEdge));
  }
  for (const [key, bEdge] of baseEdges) {
    if (!headEdges.has(key)) removedEdges.push(Object.assign({ _key: key }, bEdge));
  }

  // Rerouted: same from→to endpoints, different edge type (Archify-style geometry/route
  // change mapped onto code graphs as type swap on a stable endpoint pair).
  const reroutedEdges = [];
  const matchedAddEdge = new Set();
  const matchedRemEdge = new Set();
  for (let i = 0; i < removedEdges.length; i++) {
    if (matchedRemEdge.has(i)) continue;
    const rem = removedEdges[i];
    for (let j = 0; j < addedEdges.length; j++) {
      if (matchedAddEdge.has(j)) continue;
      const add = addedEdges[j];
      if (rem.from !== add.from || rem.to !== add.to) continue;
      if (rem.type === add.type) continue;
      reroutedEdges.push({
        from: rem.from,
        to: rem.to,
        fromType: rem.type,
        toType: add.type,
        fromEdge: rem,
        toEdge: add
      });
      matchedRemEdge.add(i);
      matchedAddEdge.add(j);
      break;
    }
  }
  if (matchedAddEdge.size || matchedRemEdge.size) {
    addedEdges = addedEdges.filter((_, i) => !matchedAddEdge.has(i));
    removedEdges = removedEdges.filter((_, i) => !matchedRemEdge.has(i));
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
  const modifiedTypes = modifiedNodes.filter((m) => {
    const k = (m.to && m.to.kind) || (m.from && m.from.kind);
    return typeKinds.includes(k);
  });

  const baseExt = new Set();
  for (const n of base.nodes) {
    if (n.kind === 'external' || n.kind === 'external-package') baseExt.add(n.id);
  }
  const headExt = new Set();
  for (const n of head.nodes) {
    if (n.kind === 'external' || n.kind === 'external-package') headExt.add(n.id);
  }
  const addedExternalDeps = [...headExt].filter((d) => !baseExt.has(d)).map((id) => {
    const n = headNodes.get(id);
    return { id, name: n ? n.name : id, builtin: n ? !!n.builtin : false };
  });
  const removedExternalDeps = [...baseExt].filter((d) => !headExt.has(d)).map((id) => {
    const n = baseNodes.get(id);
    return { id, name: n ? n.name : id, builtin: n ? !!n.builtin : false };
  });

  const violations = [];
  const seenViolations = new Set();
  for (const e of addedEdges) {
    const edge = e;
    // Architectural dependency edges between two code entities/files.
    if (!['import', 'extends', 'implements', 'method-param', 'method-return', 'field-type', 'component-props', 'di-registered'].includes(edge.type)) continue;
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

  // --- File line-count changes (for "god file" / file-growth rules) ---
  const fileLocChanges = [];
  const baseFileLocs = new Map(); // file path -> lineCount (0 if no data)
  const headFileLocs = new Map();
  const baseFilePaths = new Set(); // files that exist in base graph
  for (const n of base.nodes) {
    if (n.kind === 'file') {
      baseFilePaths.add(n.path);
      if (typeof n.lineCount === 'number' && n.lineCount > 0) {
        baseFileLocs.set(n.path, n.lineCount);
      }
    }
  }
  for (const n of head.nodes) {
    if (n.kind === 'file' && typeof n.lineCount === 'number' && n.lineCount > 0) {
      headFileLocs.set(n.path, n.lineCount);
    }
  }
  const allFilePaths = new Set([...baseFileLocs.keys(), ...headFileLocs.keys()]);
  for (const fp of allFilePaths) {
    const base = baseFileLocs.get(fp) || 0;
    const head = headFileLocs.get(fp) || 0;
    const delta = head - base;
    const deltaPercent = base > 0 ? (delta / base) * 100 : (head > 0 ? 100 : 0);
    if (delta !== 0 || base > 0 || head > 0) {
      fileLocChanges.push({ path: fp, baseLoc: base, headLoc: head, delta, deltaPercent, existedInBase: baseFilePaths.has(fp) });
    }
  }

  const summary = {
    addedNodes: finalAddedNodes.length,
    removedNodes: finalRemovedNodes.length,
    modifiedNodes: modifiedNodes.length,
    movedNodes: movedNodes.length,
    renamedNodes: renamedNodes.length,
    addedEdges: addedEdges.length,
    removedEdges: removedEdges.length,
    reroutedEdges: reroutedEdges.length,
    addedArchitecturalEdges: countArchitecturalEdges(addedEdges),
    removedArchitecturalEdges: countArchitecturalEdges(removedEdges),
    reroutedArchitecturalEdges: countArchitecturalEdges(reroutedEdges),
    addedTypes: addedTypes.length,
    removedTypes: removedTypes.length,
    modifiedTypes: modifiedTypes.length,
    addedPackages: addedPackages.length,
    removedPackages: removedPackages.length,
    addedExternalDeps: addedExternalDeps.length,
    removedExternalDeps: removedExternalDeps.length,
    violations: violations.length,
    totalChanges: finalAddedNodes.length + finalRemovedNodes.length + modifiedNodes.length
      + movedNodes.length + renamedNodes.length
      + addedEdges.length + removedEdges.length + reroutedEdges.length
      + addedExtDepsCount(addedExternalDeps, removedExternalDeps)
  };

  summary.structureChanged = (base.fingerprint || '') !== (head.fingerprint || '');
  const implChanges = diffImpls(base, head);
  summary.implChangedCount = implChanges.length;
  const behaviorChanges = diffBehaviorFingerprints(base, head, { renamedNodes });
  summary.behaviorChangedCount = behaviorChanges.length;
  summary.sourceChanged = compareSourceContentHashes(
    { contentHash: base.contentFingerprint, contentHashVersion: base.sourceContentHashVersion },
    { contentHash: head.contentFingerprint, contentHashVersion: head.sourceContentHashVersion }
  );
  if (summary.sourceChanged === null && base.contentFingerprint && head.contentFingerprint) {
    summary.sourceComparison = 'incompatible-hash-version';
  }

  // Volume heuristic only — not findings severity. Authoritative risk is
  // risk.level / MCP top-level riskLevel from summarizeFindings().
  summary.changeScale = assessRisk(summary);

  // Explain analysis-scope changes (ignore config) so removed nodes caused
  // by a new .arch-viewer-ignore rule are not read as real code deletion.
  // Only compare when both graphs carry scope (old baselines: null, no noise).
  const basePatterns = base.scope && Array.isArray(base.scope.ignorePatterns) ? base.scope.ignorePatterns : null;
  const headPatterns = head.scope && Array.isArray(head.scope.ignorePatterns) ? head.scope.ignorePatterns : null;
  let scopeChanged = null;
  if (basePatterns && headPatterns) {
    const addedPatterns = headPatterns.filter((p) => !basePatterns.includes(p));
    const removedPatterns = basePatterns.filter((p) => !headPatterns.includes(p));
    if (addedPatterns.length || removedPatterns.length) {
      scopeChanged = { added: addedPatterns, removed: removedPatterns };
      summary.scopeChanged = true;
    }
  }

  return {
    base: { fingerprint: base.fingerprint, root: base.root, stats: base.stats },
    head: { fingerprint: head.fingerprint, root: head.root, stats: head.stats },
    scopeChanged,
    summary,
    addedNodes: finalAddedNodes, removedNodes: finalRemovedNodes, modifiedNodes,
    movedNodes,
    renamedNodes,
    addedEdges, removedEdges,
    reroutedEdges,
    addedPackages, removedPackages,
    addedTypes, removedTypes,
    addedExternalDeps, removedExternalDeps,
    violations,
    fileLocChanges,
    implChanges,
    behaviorChanges
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
/** Last path segment of a file/module path (zero-dependency; forward slashes
 *  are normalized by extractors on all platforms). */
function baseName(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

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
var LAYER_RANK = { domain: 0, util: 0, dto: 1, storage: 1, config: 2, service: 3, controller: 4, entrypoint: 4, component: 5 };

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
  const sizeLabel = { none: '无变更', low: '小', medium: '中', high: '大' };
  lines.push(`  变更规模: ${sizeLabel[s.changeScale] || s.changeScale}（summary.changeScale；风险等级见下方风险发现）`);
  lines.push(`  节点变化: +${s.addedNodes} -${s.removedNodes} ~${s.modifiedNodes}`);
  if (s.movedNodes > 0) lines.push(`  移动:     ${s.movedNodes}`);
  if (s.renamedNodes > 0) lines.push(`  重命名:   ${s.renamedNodes}`);
  const archAdd = s.addedArchitecturalEdges != null ? s.addedArchitecturalEdges : s.addedEdges;
  const archRem = s.removedArchitecturalEdges != null ? s.removedArchitecturalEdges : s.removedEdges;
  lines.push(`  关系变化: +${archAdd} -${archRem}`);
  if (s.addedEdges !== archAdd || s.removedEdges !== archRem) {
    lines.push(`  原始边:   +${s.addedEdges} -${s.removedEdges}（含归属边，默认不进图）`);
  }
  if (s.reroutedEdges > 0) lines.push(`  重连:     ${s.reroutedEdges}`);
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

  const movePairs = (diff.renamedNodes || []).filter((r) => r.moved);
  const renamePairs = (diff.renamedNodes || []).filter((r) => !r.moved);
  if (movePairs.length > 0) {
    lines.push('--- 移动（跨目录，实体随文件迁移） ---');
    for (const r of movePairs)
      lines.push(`  ↔ [${r.kind}] ${r.newName}: ${r.fromPath} → ${r.toPath}`);
    lines.push('');
  }
  if (renamePairs.length > 0) {
    lines.push('--- 重命名 ---');
    for (const r of renamePairs)
      lines.push(`  ~ [${r.kind}] ${r.oldName} → ${r.newName} (${r.path})`);
    lines.push('');
  }

  if (diff.movedNodes && diff.movedNodes.length > 0) {
    lines.push('--- 移动（归属/路径） ---');
    for (const m of diff.movedNodes) {
      const bits = m.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(', ');
      lines.push(`  ↔ ${m.id} ${bits}`);
    }
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
        } else if (c.field === 'params') {
          lines.push(`  ~ ${m.id} params: ${c.from} → ${c.to}`);
        } else if (c.field === 'returnTypes' || c.field === 'paramTypes') {
          const fmt = (v) => Array.isArray(v) ? v.join('|') || '∅' : String(v);
          lines.push(`  ~ ${m.id} ${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`);
        } else if (c.field === 'signature') {
          lines.push(`  ~ ${m.id} signature changed`);
        } else if (c.field === 'enumValues') {
          if (c.added && c.added.length) lines.push(`  ~ ${m.id} +enum: ${c.added.join(', ')}`);
          if (c.removed && c.removed.length) lines.push(`  ~ ${m.id} -enum: ${c.removed.join(', ')}`);
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

  const depTypes = ARCH_EDGE_TYPES;
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

  if (diff.reroutedEdges && diff.reroutedEdges.length > 0) {
    lines.push('--- 重连关系（同端点换边类型） ---');
    for (const e of diff.reroutedEdges.slice(0, 30))
      lines.push(`  ↻ ${e.from} --${e.fromType}→${e.toType}--> ${e.to}`);
    if (diff.reroutedEdges.length > 30) lines.push(`  ... 还有 ${diff.reroutedEdges.length - 30} 条`);
    lines.push('');
  }

  if (diff.violations.length > 0) {
    lines.push('--- ⚠ 分层违规 ---');
    for (const v of diff.violations)
      lines.push(`  ⚠ ${v.fromLayer} → ${v.toLayer}: ${v.from} --${v.edgeType}--> ${v.to}`);
    lines.push('');
  }

  const implText = formatImplDiffText(diff.implChanges);
  if (implText) lines.push(implText.replace(/\n$/, ''));

  const behaviorText = formatBehaviorDiffText(diff.behaviorChanges);
  if (behaviorText) lines.push(behaviorText.replace(/\n$/, ''));

  return lines.join('\n');
}

module.exports = {
  diffGraphs,
  formatDiffText,
  edgeKey,
  assessRisk,
  inferLayer,
  canonical,
  canonicalEqual,
  SEMANTIC_NODE_FIELDS,
  ARCH_EDGE_TYPES,
  isArchitecturalEdge,
  countArchitecturalEdges
};
