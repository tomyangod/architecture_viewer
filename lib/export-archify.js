'use strict';

/**
 * Archify IR adapter — converts Architecture Viewer graphs into Archify
 * architecture JSON IR (schema_version 1) that `archify validate/render/compare`
 * accepts.
 *
 * Hard constraints learned from the Archify spike (see pm/plans/archify-integration-plan.md):
 *  1. Component/connection ids must match /^[a-zA-Z][a-zA-Z0-9_-]*$/ — no ':' '/' '.' '#'.
 *  2. grid mode is NOT auto-layout: every component needs row/col (or pos).
 *  3. clean-flow/edge-through-node is error-level even at quality=standard, so we
 *     only emit SPARSE, pre-laid-out diagrams (scopes: changed / violations / layers).
 *  4. component.sources forces meta.repository — we never emit sources.
 *  5. compare requires every connection to have a stable id.
 *  6. boundary identity is kind+label — layer labels must be stable across base/head.
 *
 * The adapter is pure (no subprocess). Callers run `archify validate` themselves
 * and fall back to the builtin renderer on failure.
 */

const crypto = require('crypto');

// Layer → fixed grid row (top = entry points). Stable across base/head so that
// Archify's `moved` status is meaningful.
const LAYER_ROWS = {
  component: 0,
  controller: 1,
  service: 2,
  domain: 3,
  storage: 4,
  dto: 5,
  config: 6,
  util: 7
};
const EXTERNAL_ROW = 8;
const UNCLASSIFIED_ROW = 9;

const ARCH_EDGE_TYPES = ['import', 'extends', 'implements', 'component-props', 'di-registered'];
const TYPE_KINDS = ['class', 'interface', 'enum', 'record', 'annotation', 'function', 'type_alias', 'component'];

// Max components before `all` scope downgrades to `layers` (clean-flow safety).
const ALL_SCOPE_MAX_COMPONENTS = 24;
// Sparse scopes (changed/violations) must stay tiny for clean-flow to pass.
const SPARSE_MAX_COMPONENTS = 14;
const MAX_COLS = 12;

function shortHash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 6);
}

/**
 * Replace every character outside [A-Za-z0-9_-] with '_' and guarantee a
 * letter prefix. Returns a token usable inside an Archify id.
 */
function cleanToken(s) {
  let t = String(s).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^[-_]+|[-_]+$/g, '');
  if (!/^[a-zA-Z]/.test(t)) t = 'n' + t;
  return t || 'n';
}

/**
 * Stable id factory with collision resolution.
 * Returns { id, map } mutated in place; `map` is id -> naturalKey (for sidecar).
 */
function makeIdAllocator() {
  const used = new Map(); // id -> naturalKey
  function alloc(prefix, naturalKey) {
    const base = prefix + cleanToken(naturalKey);
    let candidate = base;
    if (used.has(candidate) && used.get(candidate) !== naturalKey) {
      const h = shortHash(naturalKey);
      candidate = `${base}_${h}`;
      let n = 2;
      while (used.has(candidate) && used.get(candidate) !== naturalKey) {
        candidate = `${base}_${h}${n++}`;
      }
    }
    if (!used.has(candidate)) used.set(candidate, naturalKey);
    return candidate;
  }
  return { alloc, used };
}

function layerRow(layer) {
  if (layer && Object.prototype.hasOwnProperty.call(LAYER_ROWS, layer)) return LAYER_ROWS[layer];
  return UNCLASSIFIED_ROW;
}

function componentTypeFor(node) {
  if (node.kind === 'external') return 'external';
  if (node.layer === 'component') return 'frontend';
  if (node.layer === 'storage') return 'database';
  return 'backend';
}

/**
 * Build lookup helpers from a graph.
 *  - nodeById
 *  - fileKeyOf(node): canonical component key for a node (file path or external pkg)
 */
function graphIndex(graph) {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const fileNodes = graph.nodes.filter((n) => n.kind === 'file');
  const filePathToNode = new Map(fileNodes.map((n) => [n.path, n]));

  // Resolve any node (file / entity / external) to a component descriptor.
  function componentKeyOf(node) {
    if (!node) return null;
    if (node.kind === 'external') {
      return { kind: 'ext', name: node.name, layer: null, node };
    }
    if (node.kind === 'file') {
      return { kind: 'file', path: node.path, name: node.name, layer: node.layer || null, node };
    }
    // Entity → its containing file.
    if (node.path && filePathToNode.has(node.path)) {
      const f = filePathToNode.get(node.path);
      return { kind: 'file', path: f.path, name: f.name, layer: f.layer || null, node: f };
    }
    return null;
  }

  return { nodeById, filePathToNode, componentKeyOf, fileNodes };
}

/**
 * Collect the set of visible component keys for a scope, from base+head+diff.
 * Returns { keys: Map<naturalKey, descriptor>, scopeUsed, downgraded }.
 */
function selectVisible({ baseGraph, headGraph, diff, scope }) {
  const headIdx = graphIndex(headGraph);
  const baseIdx = graphIndex(baseGraph || headGraph);

  // Union of all component keys across both sides (for stable layout + base/head).
  const union = new Map(); // naturalKey -> descriptor (prefer head)
  function addKey(idx, node) {
    const k = idx.componentKeyOf(node);
    if (!k) return;
    const natural = k.kind === 'ext' ? `ext:${k.name}` : `file:${k.path}`;
    if (!union.has(natural)) union.set(natural, { ...k, natural });
  }
  for (const n of headGraph.nodes) {
    if (n.kind === 'file' || n.kind === 'external') addKey(headIdx, n);
  }
  if (baseGraph && baseGraph !== headGraph) {
    for (const n of baseGraph.nodes) {
      if (n.kind === 'file' || n.kind === 'external') addKey(baseIdx, n);
    }
  }

  let scopeUsed = scope;
  let downgraded = false;

  if (scope === 'all') {
    const fileCount = [...union.values()].filter((k) => k.kind === 'file').length;
    if (fileCount > ALL_SCOPE_MAX_COMPONENTS) {
      scopeUsed = 'layers';
      downgraded = true;
    } else {
      return { keys: union, scopeUsed, downgraded };
    }
  }

  if (scopeUsed === 'layers') {
    // Aggregate: one key per layer (and external).
    const layers = new Map();
    for (const k of union.values()) {
      const row = k.kind === 'ext' ? EXTERNAL_ROW : layerRow(k.layer);
      const layerName = k.kind === 'ext' ? '__external__' : (k.layer || '__unclassified__');
      if (!layers.has(layerName)) {
        layers.set(layerName, { kind: 'layer', layer: layerName, row, natural: `layer:${layerName}` });
      }
    }
    return { keys: layers, scopeUsed, downgraded };
  }

  // changed / violations → sparse file set
  const visible = new Map();
  function ensureFileByNode(idx, nodeId) {
    const node = idx.nodeById.get(nodeId);
    if (!node) return;
    const k = idx.componentKeyOf(node);
    if (!k) return;
    const natural = k.kind === 'ext' ? `ext:${k.name}` : `file:${k.path}`;
    if (!visible.has(natural)) visible.set(natural, { ...k, natural });
  }

  if (scopeUsed === 'violations') {
    for (const v of (diff && diff.violations) || []) {
      ensureFileByNode(headIdx, v.from);
      ensureFileByNode(headIdx, v.to);
    }
    return { keys: visible, scopeUsed, downgraded };
  }

  // changed (default): files touched by added/removed/modified/renamed entities,
  // plus newly added external packages.
  const touchedPaths = new Set();
  function noteEntity(entityNode) {
    if (!entityNode) return;
    if (entityNode.path) touchedPaths.add(entityNode.path);
  }
  if (diff) {
    for (const a of diff.addedNodes || []) noteEntity(a.node);
    for (const r of diff.removedNodes || []) noteEntity(r.node);
    for (const m of diff.modifiedNodes || []) noteEntity(m.to || m.from || m.node);
    for (const rn of diff.renamedNodes || []) { noteEntity(rn.to); noteEntity(rn.from); }
    for (const dep of diff.addedExternalDeps || []) {
      // external dep objects: { name } or node-like
      const name = dep.name || (dep.node && dep.node.name);
      if (name) {
        const natural = `ext:${name}`;
        if (!visible.has(natural)) {
          visible.set(natural, { kind: 'ext', name, layer: null, natural, node: dep.node || null });
        }
      }
    }
  }
  for (const [natural, k] of union) {
    if (k.kind === 'file' && touchedPaths.has(k.path)) visible.set(natural, k);
  }
  return { keys: visible, scopeUsed, downgraded };
}

/**
 * Assign stable row/col over the visible key set.
 * - Layer-summary view (one node per layer): place nodes on the DIAGONAL
 *   (col = row) so cross-layer edges never run straight through an intermediate
 *   layer node (clean-flow/edge-through-node).
 * - File/ext view: group by layer row, fill columns by sorted path within a row.
 * Returns { positions: Map<natural, {row, col}>, cols }.
 */
function computeLayout(keys, diagonal = false) {
  const byRow = new Map();
  for (const k of keys.values()) {
    const row = k.kind === 'layer' ? k.row : (k.kind === 'ext' ? EXTERNAL_ROW : layerRow(k.layer));
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(k);
  }
  const positions = new Map();
  let cols = 4;
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  for (const row of rows) {
    const members = byRow.get(row);
    members.sort((a, b) => (a.natural || '').localeCompare(b.natural || ''));
    if (diagonal) {
      // One node per layer row → spread across columns on the diagonal.
      members.forEach((m, i) => positions.set(m.natural, { row, col: row + i }));
      cols = Math.max(cols, row + members.length);
    } else {
      members.forEach((m, i) => positions.set(m.natural, { row, col: i }));
      cols = Math.max(cols, members.length);
    }
  }
  cols = Math.min(cols, MAX_COLS);
  return { positions, cols };
}

/**
 * Build violation lookup (file-pair level) from diff.violations.
 * key: `${fromNatural}|${toNatural}` -> { label }
 */
function violationPairs(diff, idx) {
  const out = new Map();
  for (const v of (diff && diff.violations) || []) {
    const fromNode = idx.nodeById.get(v.from);
    const toNode = idx.nodeById.get(v.to);
    const fk = idx.componentKeyOf(fromNode);
    const tk = idx.componentKeyOf(toNode);
    if (!fk || !tk) continue;
    const fn = fk.kind === 'ext' ? `ext:${fk.name}` : `file:${fk.path}`;
    const tn = tk.kind === 'ext' ? `ext:${tk.name}` : `file:${tk.path}`;
    out.set(`${fn}|${tn}`, { label: v.edgeType || 'cross-layer' });
  }
  return out;
}

/**
 * Build connections for one side graph given visible keys + layout + id allocator.
 * Returns array of connection objects.
 */
function buildConnections({ graph, idx, visible, layout, idAlloc, violations, scopeUsed }) {
  const posOf = (natural) => layout.positions.get(natural);
  const isVisible = (natural) => visible.has(natural);

  // For layers scope, aggregate edges between layer rows.
  if (scopeUsed === 'layers') {
    const agg = new Map(); // `${fromLayer}|${toLayer}` -> count, violation?
    for (const e of graph.edges) {
      if (!ARCH_EDGE_TYPES.includes(e.type)) continue;
      const f = idx.componentKeyOf(idx.nodeById.get(e.from));
      const t = idx.componentKeyOf(idx.nodeById.get(e.to));
      if (!f || !t) continue;
      const fl = f.kind === 'ext' ? '__external__' : (f.layer || '__unclassified__');
      const tl = t.kind === 'ext' ? '__external__' : (t.layer || '__unclassified__');
      if (fl === tl) continue;
      const key = `${fl}|${tl}`;
      const cur = agg.get(key) || { count: 0, fromLayer: fl, toLayer: tl, security: false };
      cur.count += 1;
      agg.set(key, cur);
    }
    const conns = [];
    for (const a of agg.values()) {
      const fromNat = `layer:${a.fromLayer}`;
      const toNat = `layer:${a.toLayer}`;
      const fp = posOf(fromNat);
      const tp = posOf(toNat);
      if (!fp || !tp) continue;
      const fromId = idAlloc.alloc('L_', a.fromLayer);
      const toId = idAlloc.alloc('L_', a.toLayer);
      const id = `e_${fromId}__${toId}`;
      // No label: machine-generated edges rely on variant + sidecar (clean-flow).
      const conn = { id, from: fromId, to: toId };
      if (fp.row < tp.row) { conn.fromSide = 'bottom'; conn.toSide = 'top'; }
      else if (fp.row > tp.row) { conn.fromSide = 'top'; conn.toSide = 'bottom'; }
      conns.push(conn);
    }
    return conns;
  }

  // File/ext granularity — dedupe to component pairs.
  const seen = new Map(); // `${fromNatural}|${toNatural}` -> connection seed
  for (const e of graph.edges) {
    if (!ARCH_EDGE_TYPES.includes(e.type)) continue;
    const f = idx.componentKeyOf(idx.nodeById.get(e.from));
    const t = idx.componentKeyOf(idx.nodeById.get(e.to));
    if (!f || !t) continue;
    const fn = f.kind === 'ext' ? `ext:${f.name}` : `file:${f.path}`;
    const tn = t.kind === 'ext' ? `ext:${t.name}` : `file:${t.path}`;
    if (fn === tn) continue;
    if (!isVisible(fn) || !isVisible(tn)) continue;

    const pairKey = `${fn}|${tn}`;
    const isInheritance = e.type === 'extends' || e.type === 'implements';
    const viol = violations ? violations.get(pairKey) : null;

    if (!seen.has(pairKey)) {
      seen.set(pairKey, {
        fromNat: fn, toNat: tn,
        variant: viol ? 'security' : (isInheritance ? 'dashed' : 'default'),
        label: viol ? `violation: ${viol.label}` : (isInheritance ? e.type : undefined),
        edgeTypes: new Set([e.type])
      });
    } else {
      const seed = seen.get(pairKey);
      seed.edgeTypes.add(e.type);
      if (viol) { seed.variant = 'security'; seed.label = `violation: ${viol.label}`; }
    }
  }

  const conns = [];
  const droppedSameLayer = [];
  for (const seed of seen.values()) {
    const fp = posOf(seed.fromNat);
    const tp = posOf(seed.toNat);
    if (!fp || !tp) continue;

    // Same-layer edge: keep only if columns are adjacent (clean-flow safety).
    if (fp.row === tp.row) {
      if (Math.abs(fp.col - tp.col) > 1) {
        droppedSameLayer.push(seed);
        continue;
      }
    }

    // Component ids are allocated by the same shared allocator keyed on the
    // natural key, so these match the ids emitted in buildComponents.
    const fromId = idAlloc.alloc('n_', seed.fromNat);
    const toId = idAlloc.alloc('n_', seed.toNat);
    const id = `e_${fromId}__${toId}`;
    // Machine-generated edges carry NO label: the security(red)/dashed variant
    // conveys semantics, and auto-placed labels collide with nodes (clean-flow).
    // Full rule/edge-type detail is recorded in the sidecar instead.
    const conn = { id, from: fromId, to: toId };
    if (seed.variant !== 'default') conn.variant = seed.variant;

    // Side direction: perpendicular to the row band for cross-layer edges.
    if (fp.row !== tp.row) {
      if (fp.row < tp.row) { conn.fromSide = 'bottom'; conn.toSide = 'top'; }
      else { conn.fromSide = 'top'; conn.toSide = 'bottom'; }
    }
    conns.push(conn);
  }
  return { conns, droppedSameLayer };
}

/**
 * Build components for one side.
 */
function buildComponents({ graph, idx, visible, layout, idAlloc, scopeUsed }) {
  const components = [];
  const present = new Set();

  if (scopeUsed === 'layers') {
    for (const k of visible.values()) {
      const id = idAlloc.alloc('L_', k.layer);
      if (present.has(id)) continue;
      present.add(id);
      const p = layout.positions.get(k.natural);
      const isExtLayer = k.layer === '__external__';
      components.push({
        id,
        type: isExtLayer ? 'external' : (k.layer === 'storage' ? 'database' : (k.layer === 'component' ? 'frontend' : 'backend')),
        label: isExtLayer ? 'External deps' : (k.layer === '__unclassified__' ? 'Unclassified' : k.layer),
        row: p.row,
        col: p.col
      });
    }
    return components;
  }

  for (const k of visible.values()) {
    const natural = k.natural;
    // Only include keys that exist in THIS side graph.
    const exists = k.kind === 'ext'
      ? graph.nodes.some((n) => n.kind === 'external' && n.name === k.name)
      : graph.nodes.some((n) => n.kind === 'file' && n.path === k.path);
    if (!exists) continue;
    const id = idAlloc.alloc('n_', natural);
    if (present.has(id)) continue;
    present.add(id);
    const p = layout.positions.get(natural);
    const comp = {
      id,
      type: componentTypeFor(k.node || { kind: k.kind === 'ext' ? 'external' : 'file', layer: k.layer }),
      label: k.kind === 'ext' ? k.name : k.name,
      row: p.row,
      col: p.col
    };
    if (k.kind === 'file') {
      // Keep sublabel short (grid cell is ~112px); full path lives in the sidecar.
      if (k.layer) { comp.sublabel = k.layer; comp.tag = k.layer; }
      // Truncate over-long file names so the primary label fits the cell.
      if (comp.label.length > 24) comp.label = comp.label.slice(0, 21) + '...';
    }
    components.push(comp);
  }
  return components;
}

/**
 * Build a complete Archify IR object for one side.
 */
function buildIR({ graph, visible, layout, idAlloc, violations, scopeUsed, title }) {
  const idx = graphIndex(graph);
  const components = buildComponents({ graph, idx, visible, layout, idAlloc, scopeUsed });

  let connections = [];
  let boundaries = [];
  let droppedSameLayer = 0;
  if (scopeUsed === 'layers') {
    connections = buildConnections({ graph, idx, visible, layout, idAlloc, violations, scopeUsed });
  } else {
    const r = buildConnections({ graph, idx, visible, layout, idAlloc, violations, scopeUsed });
    connections = r.conns;
    droppedSameLayer = r.droppedSameLayer.length;
    // One region boundary per present layer.
    const byLayer = new Map();
    for (const c of components) {
      const layer = c.tag || (c.type === 'external' ? null : (c.type === 'database' ? 'storage' : (c.type === 'frontend' ? 'component' : '__backend__')));
      // Recover layer from visible key via tag (set on file comps). External/unlayered skipped.
      if (!c.tag) continue;
      if (!byLayer.has(c.tag)) byLayer.set(c.tag, []);
      byLayer.get(c.tag).push(c.id);
    }
    for (const [layer, ids] of byLayer) {
      boundaries.push({ kind: 'region', label: `${layer} layer`, wraps: ids });
    }
  }

  const ir = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title,
      quality_profile: 'standard'
    },
    layout: { mode: 'grid', cols: layout.cols },
    components,
    connections
  };
  if (boundaries.length) ir.boundaries = boundaries;

  return { ir, droppedSameLayer };
}

/**
 * Build a base/head IR pair with a shared layout seed (so Archify delta can
 * detect `moved`/`rerouted` and keeps coordinates stable).
 *
 * @param {object} opts
 * @param {object} opts.headGraph - current graph (required)
 * @param {object} [opts.baseGraph] - baseline graph (defaults to headGraph)
 * @param {object} [opts.diff] - diffGraphs result (for changed/violations scopes)
 * @param {string} [opts.scope='changed'] - changed | violations | layers | all
 * @param {string} [opts.title]
 * @returns {{ base: object, head: object, sidecar: object }}
 */
/**
 * Count components that WOULD be emitted for one graph given the visible key set.
 * Used by the sparse guardrail before building.
 */
function countEmitted(graph, keys, scopeUsed) {
  if (scopeUsed === 'layers') {
    const layers = new Set();
    for (const k of keys.values()) layers.add(k.natural);
    return layers.size;
  }
  let n = 0;
  for (const k of keys.values()) {
    const exists = k.kind === 'ext'
      ? graph.nodes.some((x) => x.kind === 'external' && x.name === k.name)
      : graph.nodes.some((x) => x.kind === 'file' && x.path === k.path);
    if (exists) n++;
  }
  return n;
}

function buildArchifyPair({ headGraph, baseGraph, diff, scope = 'changed', title = 'Architecture' }) {
  const base = baseGraph || headGraph;

  let selection = selectVisible({ baseGraph: base, headGraph, diff, scope });
  let downgradeReason = selection.downgraded ? 'too-many-files' : null;

  // Sparse guardrail: Archify clean-flow fails on dense graphs, and a side with
  // 0 components is schema-invalid. Downgrade to the layer-summary view.
  if (selection.scopeUsed !== 'layers') {
    const headCount = countEmitted(headGraph, selection.keys, selection.scopeUsed);
    const baseCount = countEmitted(base, selection.keys, selection.scopeUsed);
    const tooDense = selection.keys.size > SPARSE_MAX_COMPONENTS;
    const emptySide = headCount === 0 || baseCount === 0;
    if (tooDense || emptySide) {
      downgradeReason = tooDense ? 'too-dense-for-clean-flow' : 'empty-side-pure-addition';
      selection = selectVisible({ baseGraph: base, headGraph, diff, scope: 'layers' });
    }
  }

  const { keys, scopeUsed } = selection;
  const layout = computeLayout(keys, scopeUsed === 'layers');

  // Shared allocator so the same natural key → same id on both sides.
  const idAlloc = makeIdAllocator();

  const headIdx = graphIndex(headGraph);
  const violations = violationPairs(diff, headIdx);

  const headRes = buildIR({ graph: headGraph, visible: keys, layout, idAlloc, violations, scopeUsed, title: `${title} — After` });
  const baseRes = buildIR({ graph: base, visible: keys, layout, idAlloc, violations: new Map(), scopeUsed, title: `${title} — Before` });

  const sidecar = {
    tool: 'architecture-viewer',
    schema: 'archify-architecture-v1',
    scopeRequested: scope,
    scopeUsed,
    downgradedToLayers: scopeUsed === 'layers' && scope !== 'layers',
    downgradeReason,
    idMap: Object.fromEntries(idAlloc.used), // archifyId -> naturalKey
    droppedSameLayerEdges: headRes.droppedSameLayer + baseRes.droppedSameLayer,
    componentCount: { base: baseRes.ir.components.length, head: headRes.ir.components.length },
    connectionCount: { base: baseRes.ir.connections.length, head: headRes.ir.connections.length },
    note: 'Sparse, pre-laid-out IR. No sources/repository emitted. Validate with: archify validate architecture <file> --quality standard'
  };

  return { base: baseRes.ir, head: headRes.ir, sidecar };
}

module.exports = {
  buildArchifyPair,
  // exported for testing
  _internal: { cleanToken, makeIdAllocator, computeLayout, selectVisible, layerRow, LAYER_ROWS }
};
