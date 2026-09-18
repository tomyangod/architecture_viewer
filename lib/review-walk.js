'use strict';

/**
 * Review Walk — ordered reading path for human review of an AI change set.
 *
 * Builds from already-extracted facts (call edges, layers, behavior sinks,
 * layer findings). Does not invent domain names or judge business correctness.
 */

const { CALL_EDGE } = require('./extract/call-graph');
const { fingerprintFromImpl } = require('./extract/behavior-fingerprint');
const { LAYER_RANK, layerLabel } = require('./risk-rules');

const STEP_CAP = 24;
const SKIP_CAP = 12;

const ENTRY_LAYERS = new Set(['controller', 'entrypoint', 'component']);
const WALK_KINDS = new Set([
  'class', 'interface', 'enum', 'record', 'annotation', 'function',
  'type_alias', 'component'
]);
const WALK_SEED_KINDS = new Set([
  'class', 'interface', 'enum', 'record', 'annotation', 'function',
  'type_alias', 'component', 'file'
]);
const LAYER_EDGE_RULES = new Set([
  'layer-skip', 'cross-layer-violation', 'forbid-cross-layer'
]);
const ARCH_FALLBACK_TYPES = new Set([
  'import', 'extends', 'implements', 'field-type', 'method-param',
  'method-return', 'component-props', 'di-registered'
]);

function emptyWalk(reason) {
  return {
    entry: null,
    steps: [],
    skips: [],
    stats: {
      stepCount: 0,
      sinkCount: 0,
      skipCount: 0,
      entryFound: false,
      usedCallEdges: false,
      reason: reason || null
    }
  };
}

function nodeMap(graph) {
  const m = new Map();
  for (const n of (graph && graph.nodes) || []) {
    if (n && n.id) m.set(n.id, n);
  }
  return m;
}

function displayName(node, method) {
  if (!node) return method || '?';
  if (method && node.name && method !== node.name) return `${node.name}.${method}`;
  return node.name || node.id;
}

function statusOfId(id, sets) {
  if (sets.added.has(id)) return 'added';
  if (sets.removed.has(id)) return 'removed';
  if (sets.renamed.has(id)) return 'renamed';
  if (sets.modified.has(id)) return 'modified';
  if (sets.moved.has(id)) return 'moved';
  if (sets.behavior.has(id) || sets.impl.has(id)) return 'modified';
  return 'unchanged';
}

function collectChangeSets(diff) {
  const added = new Set((diff.addedNodes || []).map((n) => n.id));
  const removed = new Set((diff.removedNodes || []).map((n) => n.id));
  const modified = new Set((diff.modifiedNodes || []).map((n) => n.id));
  const moved = new Set((diff.movedNodes || []).map((n) => n.id));
  const renamed = new Set();
  for (const r of diff.renamedNodes || []) {
    if (r.from && r.from.id) renamed.add(r.from.id);
    if (r.to && r.to.id) renamed.add(r.to.id);
  }
  const behavior = new Set();
  const behaviorById = new Map();
  for (const c of diff.behaviorChanges || []) {
    if (!c || !c.id) continue;
    behavior.add(c.id);
    const list = behaviorById.get(c.id) || [];
    list.push(c);
    behaviorById.set(c.id, list);
  }
  const impl = new Set((diff.implChanges || []).map((c) => c && c.id).filter(Boolean));
  return { added, removed, modified, moved, renamed, behavior, impl, behaviorById };
}

function seedChangedIds(diff, findings, sets) {
  const ids = new Set();
  for (const s of [sets.added, sets.removed, sets.modified, sets.moved, sets.renamed, sets.behavior, sets.impl]) {
    for (const id of s) ids.add(id);
  }
  for (const f of findings || []) {
    if (f.from) ids.add(f.from);
    if (f.to) ids.add(f.to);
  }
  return ids;
}

function isWalkNode(node) {
  return !!(node && WALK_KINDS.has(node.kind));
}

function isSeedNode(node) {
  return !!(node && WALK_SEED_KINDS.has(node.kind));
}

function parseSinkToken(token) {
  const raw = String(token || '');
  const i = raw.indexOf(':');
  if (i <= 0) return { kind: 'other', name: raw, confidence: 'low' };
  return { kind: raw.slice(0, i), name: raw.slice(i + 1), confidence: 'medium' };
}

function pushSink(out, seen, s, change) {
  if (!s) return;
  const kind = s.kind || 'other';
  const name = s.name || '?';
  const key = (change === 'removed' ? 'rm:' : '') + kind + ':' + name;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    kind,
    name,
    confidence: s.confidence || 'low',
    change: change || 'present'
  });
}

function fingerprintsOn(node) {
  const fps = [];
  if (!node) return fps;
  if (node.behavior) fps.push(node.behavior);
  if (node.impl && node.impl.behavior) fps.push(node.impl.behavior);
  else if (node.impl) {
    const fp = fingerprintFromImpl(node.impl);
    if (fp) fps.push(fp);
  }
  for (const impl of Object.values(node.methodImpls || {})) {
    if (!impl) continue;
    if (impl.behavior) fps.push(impl.behavior);
    else {
      const fp = fingerprintFromImpl(impl);
      if (fp) fps.push(fp);
    }
  }
  return fps;
}

function sinksFor(id, sets, lookup) {
  const out = [];
  const seen = new Set();
  const behList = sets.behaviorById.get(id) || [];
  for (const c of behList) {
    for (const token of c.addedSinks || []) pushSink(out, seen, parseSinkToken(token), 'added');
    for (const token of c.removedSinks || []) pushSink(out, seen, parseSinkToken(token), 'removed');
  }
  if (out.length) return out;
  for (const fp of fingerprintsOn(lookup(id))) {
    for (const s of (fp && fp.sinkSet) || []) pushSink(out, seen, s, 'present');
  }
  return out;
}

function changeSummary(id, sets, lookup) {
  const bits = [];
  const st = statusOfId(id, sets);
  if (st === 'added') bits.push('本轮新增');
  else if (st === 'removed') bits.push('本轮删除');
  else if (st === 'moved') bits.push('本轮移动');
  else if (st === 'renamed') bits.push('本轮重命名');
  else if (st === 'modified') bits.push('本轮修改');

  const beh = (sets.behaviorById.get(id) || [])[0];
  if (beh) {
    if (beh.addedCalls && beh.addedCalls.length) bits.push('+call ' + beh.addedCalls.slice(0, 3).join(', '));
    if (beh.removedCalls && beh.removedCalls.length) bits.push('-call ' + beh.removedCalls.slice(0, 3).join(', '));
    if (beh.addedThrows && beh.addedThrows.length) bits.push('+throw ' + beh.addedThrows.slice(0, 2).join(', '));
  }
  const node = lookup(id);
  if (!bits.length && node) bits.push('在变更闭包中');
  return bits.join(' · ') || null;
}

function fileIdOf(node) {
  if (!node || !node.path) return null;
  return node.path.startsWith('file:') ? node.path : ('file:' + node.path);
}

function findingTouches(id, node, finding) {
  if (!finding) return false;
  if (finding.from === id || finding.to === id) return true;
  const fileId = fileIdOf(node);
  if (fileId && (finding.from === fileId || finding.to === fileId)) return true;
  if (node && node.path && (finding.from === node.path || finding.to === node.path)) return true;
  return false;
}

function layerSkipHits(id, node, findings) {
  const hits = [];
  for (const f of findings || []) {
    if (!LAYER_EDGE_RULES.has(f.rule)) continue;
    if (findingTouches(id, node, f)) hits.push(f);
  }
  return hits;
}

function ownerWalkId(id, lookup) {
  const n = lookup(id);
  if (isWalkNode(n)) return n.id;
  return null;
}

function expandSkipEndpoints(findings, lookup, allNodes, walkIds) {
  for (const f of findings || []) {
    if (!LAYER_EDGE_RULES.has(f.rule)) continue;
    for (const raw of [f.from, f.to]) {
      if (!raw) continue;
      const owned = ownerWalkId(raw, lookup);
      if (owned) {
        walkIds.add(owned);
        continue;
      }
      const n = lookup(raw);
      const filePath = (n && n.kind === 'file' && n.path) ? n.path
        : (String(raw).startsWith('file:') ? String(raw).slice(5) : null);
      if (!filePath) continue;
      for (const node of allNodes) {
        if (node && node.path === filePath && isWalkNode(node)) walkIds.add(node.id);
      }
    }
  }
}

function pickEntry(walkIds, lookup, adjIn, sets) {
  const candidates = [...walkIds].map(lookup).filter(isWalkNode);
  if (!candidates.length) return null;

  const changedFirst = (a, b) => {
    const ac = statusOfId(a.id, sets) !== 'unchanged' ? 0 : 1;
    const bc = statusOfId(b.id, sets) !== 'unchanged' ? 0 : 1;
    if (ac !== bc) return ac - bc;
    const ar = LAYER_RANK[a.layer] != null ? LAYER_RANK[a.layer] : -1;
    const br = LAYER_RANK[b.layer] != null ? LAYER_RANK[b.layer] : -1;
    return br - ar || String(a.path || '').localeCompare(String(b.path || ''))
      || String(a.name || '').localeCompare(String(b.name || ''));
  };

  const entryLayer = candidates.filter((n) => ENTRY_LAYERS.has(n.layer)).sort(changedFirst);
  if (entryLayer.length) {
    return {
      id: entryLayer[0].id,
      name: entryLayer[0].name,
      layer: entryLayer[0].layer || null,
      path: entryLayer[0].path || null,
      reason: `入口层（${layerLabel(entryLayer[0].layer)}）`
    };
  }

  const roots = candidates
    .filter((n) => !(adjIn.get(n.id) || []).some((from) => walkIds.has(from)))
    .sort(changedFirst);
  if (roots.length) {
    return {
      id: roots[0].id,
      name: roots[0].name,
      layer: roots[0].layer || null,
      path: roots[0].path || null,
      reason: '变更闭包中无入边的节点'
    };
  }

  const ranked = candidates.slice().sort(changedFirst);
  const n = ranked[0];
  return {
    id: n.id,
    name: n.name,
    layer: n.layer || null,
    path: n.path || null,
    reason: '按层位与变更优先选取'
  };
}

function topoFrom(entryId, walkIds, adjOut) {
  const ordered = [];
  const seen = new Set();
  const stack = [entryId];
  while (stack.length) {
    const id = stack.shift();
    if (!walkIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    const next = (adjOut.get(id) || []).slice().sort();
    for (const to of next) {
      if (!seen.has(to)) stack.push(to);
    }
  }
  // Orphans not reachable from entry — append by path
  const rest = [...walkIds].filter((id) => !seen.has(id)).sort();
  for (const id of rest) ordered.push(id);
  return ordered;
}

function buildAdjacency(edges, walkIds) {
  const adjOut = new Map();
  const adjIn = new Map();
  for (const e of edges) {
    if (!walkIds.has(e.from) || !walkIds.has(e.to)) continue;
    if (e.from === e.to) continue;
    if (!adjOut.has(e.from)) adjOut.set(e.from, []);
    if (!adjIn.has(e.to)) adjIn.set(e.to, []);
    if (!adjOut.get(e.from).includes(e.to)) adjOut.get(e.from).push(e.to);
    if (!adjIn.get(e.to).includes(e.from)) adjIn.get(e.to).push(e.from);
  }
  return { adjOut, adjIn };
}

/**
 * @param {object} opts
 * @param {object} opts.headGraph
 * @param {object} [opts.baseGraph]
 * @param {object} opts.diff
 * @param {Array} [opts.findings]
 * @returns {object} reviewWalk payload
 */
function buildReviewWalk({ headGraph, baseGraph, diff, findings }) {
  if (!headGraph || !diff) return emptyWalk('missing-graph');

  const head = nodeMap(headGraph);
  const base = nodeMap(baseGraph);
  const lookup = (id) => head.get(id) || base.get(id);
  const allNodes = [...head.values(), ...base.values()];
  const sets = collectChangeSets(diff);
  const seeded = seedChangedIds(diff, findings, sets);

  // Seed from changed entities; files only expand neighbors, not final steps
  const seedWalk = new Set();
  for (const id of seeded) {
    const n = lookup(id);
    if (isSeedNode(n)) seedWalk.add(id);
  }

  // Prefer head call edges lifted onto walk (type/function) nodes
  const callSeen = new Set();
  const uniqueCalls = [];
  for (const e of (headGraph.edges || []).filter((e) => e.type === CALL_EDGE)) {
    const from = ownerWalkId(e.from, lookup);
    const to = ownerWalkId(e.to, lookup);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}|${e.line || ''}`;
    if (callSeen.has(key)) continue;
    callSeen.add(key);
    uniqueCalls.push({ from, to, type: CALL_EDGE, line: e.line, file: e.file, method: e.method || e.callee || null });
  }

  const walkIds = new Set();
  for (const id of seedWalk) {
    if (isWalkNode(lookup(id))) walkIds.add(id);
  }
  for (const e of uniqueCalls) {
    if (seedWalk.has(e.from) || seedWalk.has(e.to)) {
      walkIds.add(e.from);
      walkIds.add(e.to);
    }
  }
  expandSkipEndpoints(findings, lookup, allNodes, walkIds);

  let usedCallEdges = uniqueCalls.some((e) => walkIds.has(e.from) && walkIds.has(e.to));
  let walkEdges = uniqueCalls.filter((e) => walkIds.has(e.from) && walkIds.has(e.to));

  if (!walkEdges.length) {
    const arch = (headGraph.edges || []).filter((e) => ARCH_FALLBACK_TYPES.has(e.type));
    walkEdges = arch
      .map((e) => ({ from: ownerWalkId(e.from, lookup), to: ownerWalkId(e.to, lookup), type: e.type }))
      .filter((e) => e.from && e.to && e.from !== e.to && walkIds.has(e.from) && walkIds.has(e.to));
    usedCallEdges = false;
  }

  if (!walkIds.size) {
    return emptyWalk('no-changed-entities');
  }

  const { adjOut, adjIn } = buildAdjacency(walkEdges, walkIds);
  const entry = pickEntry(walkIds, lookup, adjIn, sets);
  const order = topoFrom(entry ? entry.id : [...walkIds].sort()[0], walkIds, adjOut);

  const steps = [];
  let sinkCount = 0;
  for (const id of order) {
    if (steps.length >= STEP_CAP) break;
    const node = lookup(id);
    if (!isWalkNode(node)) continue;
    const beh = (sets.behaviorById.get(id) || [])[0];
    const method = beh ? beh.method : null;
    const sinks = sinksFor(id, sets, lookup);
    sinkCount += sinks.filter((s) => s.change === 'added' || s.change === 'present').length;
    const skips = layerSkipHits(id, node, findings);
    const st = statusOfId(id, sets);
    // Prefer changed / violation / sink nodes; still keep entry and call-chain neighbors
    const interesting = st !== 'unchanged' || sinks.length || skips.length
      || (entry && entry.id === id)
      || usedCallEdges;
    if (!interesting && steps.length > 0) continue;

    steps.push({
      order: steps.length + 1,
      id,
      name: displayName(node, method),
      method: method || null,
      kind: node.kind,
      layer: node.layer || null,
      path: node.path || null,
      line: (beh && beh.line) || node.line || null,
      status: st,
      changeSummary: changeSummary(id, sets, lookup),
      sinks,
      layerSkip: skips.length > 0,
      violationDetail: skips[0] ? (skips[0].detail || skips[0].message || null) : null,
      why: entry && entry.id === id
        ? (entry.reason || '走查入口')
        : (skips.length ? '涉及分层违规' : (sinks.length ? '有副作用信号' : '调用链下一跳'))
    });
  }

  // If filtering dropped everything except nothing, rebuild without interesting filter
  if (!steps.length) {
    for (const id of order.slice(0, STEP_CAP)) {
      const node = lookup(id);
      if (!isWalkNode(node)) continue;
      const beh = (sets.behaviorById.get(id) || [])[0];
      const sinks = sinksFor(id, sets, lookup);
      const skips = layerSkipHits(id, node, findings);
      steps.push({
        order: steps.length + 1,
        id,
        name: displayName(node, beh && beh.method),
        method: (beh && beh.method) || null,
        kind: node.kind,
        layer: node.layer || null,
        path: node.path || null,
        line: (beh && beh.line) || node.line || null,
        status: statusOfId(id, sets),
        changeSummary: changeSummary(id, sets, lookup),
        sinks,
        layerSkip: skips.length > 0,
        violationDetail: skips[0] ? (skips[0].detail || skips[0].message || null) : null,
        why: '变更闭包'
      });
    }
  }

  const skips = [];
  const skipSeen = new Set();
  for (const f of findings || []) {
    if (!LAYER_EDGE_RULES.has(f.rule)) continue;
    const key = `${f.from || ''}|${f.to || ''}|${f.rule}|${f.detail || ''}`;
    if (skipSeen.has(key)) continue;
    skipSeen.add(key);
    const fromN = f.from ? lookup(f.from) : null;
    const toN = f.to ? lookup(f.to) : null;
    const fromWalk = fromN && isWalkNode(fromN) ? fromN
      : allNodes.find((n) => isWalkNode(n) && n.path && (f.from === 'file:' + n.path || f.from === n.path));
    const toWalk = toN && isWalkNode(toN) ? toN
      : allNodes.find((n) => isWalkNode(n) && n.path && (f.to === 'file:' + n.path || f.to === n.path));
    skips.push({
      rule: f.rule,
      from: f.from || null,
      to: f.to || null,
      fromName: (fromWalk || fromN) ? (fromWalk || fromN).name : null,
      toName: (toWalk || toN) ? (toWalk || toN).name : null,
      fromLayer: (fromWalk || fromN) ? (fromWalk || fromN).layer : null,
      toLayer: (toWalk || toN) ? (toWalk || toN).layer : null,
      detail: f.detail || f.message || null,
      file: f.file || null
    });
    if (skips.length >= SKIP_CAP) break;
  }

  return {
    entry,
    steps,
    skips,
    stats: {
      stepCount: steps.length,
      sinkCount,
      skipCount: skips.length,
      entryFound: !!entry,
      usedCallEdges,
      reason: steps.length ? null : 'empty-after-filter'
    }
  };
}

const CALL_EDGE_CAP = 80;

/**
 * Call edges among report entities (for Delta drawing). Not architectural
 * and not part of the structure fingerprint.
 */
function collectCallEdges(headGraph, entityIds) {
  const ids = entityIds instanceof Set ? entityIds : new Set(entityIds || []);
  const out = [];
  const seen = new Set();
  for (const e of (headGraph && headGraph.edges) || []) {
    if (!e || e.type !== CALL_EDGE) continue;
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    if (e.from === e.to) continue;
    const key = `${e.from}|${e.to}|${e.line || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from: e.from,
      to: e.to,
      type: CALL_EDGE,
      status: 'call',
      method: e.method || e.callee || null,
      file: e.file || null,
      line: e.line || null,
      confidence: e.confidence || null,
      violation: false
    });
    if (out.length >= CALL_EDGE_CAP) break;
  }
  return out;
}

const WALK_TEXT_LINE_CAP = 8;

function sinkBadge(sinks) {
  const bits = [];
  for (const s of (sinks || []).slice(0, 2)) {
    bits.push((s.change === 'removed' ? '-' : '') + (s.kind || '?') + ':' + (s.name || ''));
  }
  return bits.join(',');
}

/**
 * ≤8 行对话走查。长内容仍在 HTML。
 */
function formatReviewWalkText(walk, opts) {
  const reportPath = (opts && opts.reportPath) || '.av/session-report.html';
  const w = walk || emptyWalk();
  const steps = w.steps || [];
  const skips = w.skips || [];
  const entry = w.entry;
  const lines = [];

  if (!steps.length) {
    lines.push('审查走查 · 本轮没有可走查的变更闭包');
    lines.push(`详情（可选）：${reportPath}`);
    return lines.join('\n');
  }

  const headBits = [`审查走查 · ${steps.length} 步`];
  if (entry && entry.name) {
    headBits.push(`入口 ${entry.name}${entry.layer ? '（' + layerLabel(entry.layer) + '）' : ''}`);
  }
  if (skips.length) headBits.push(`越层 ${skips.length}`);
  if (w.stats && w.stats.sinkCount) headBits.push(`副作用 ${w.stats.sinkCount}`);
  lines.push(headBits.join(' · '));

  const skipBudget = skips.length ? 1 : 0;
  const stepBudget = Math.max(1, WALK_TEXT_LINE_CAP - 2 - skipBudget);
  const shown = steps.slice(0, stepBudget);
  for (const step of shown) {
    const tags = [];
    if (step.layer) tags.push(step.layer);
    if (step.status && step.status !== 'unchanged') tags.push(step.status === 'added' ? '新增' : step.status === 'removed' ? '删除' : step.status === 'modified' ? '修改' : step.status);
    if (step.layerSkip) tags.push('越层');
    const sink = sinkBadge(step.sinks);
    if (sink) tags.push(sink);
    lines.push(`${step.order}. ${step.name}${tags.length ? '  [' + tags.join(' · ') + ']' : ''}`);
  }
  if (steps.length > shown.length) {
    lines.push(`…另有 ${steps.length - shown.length} 步，见 HTML`);
  }
  if (skips.length && lines.length < WALK_TEXT_LINE_CAP) {
    const sk = skips[0];
    const more = skips.length > 1 ? ` 等 ${skips.length} 条` : '';
    lines.push(`⚠ 越层：${sk.fromName || sk.from || '?'} → ${sk.toName || sk.to || '?'}${more}`);
  }
  if (lines.length < WALK_TEXT_LINE_CAP) {
    lines.push(`详情（可选）：${reportPath}`);
  }
  return lines.slice(0, WALK_TEXT_LINE_CAP).join('\n');
}

module.exports = {
  buildReviewWalk,
  emptyWalk,
  formatReviewWalkText,
  collectCallEdges,
  WALK_TEXT_LINE_CAP,
  STEP_CAP
};
