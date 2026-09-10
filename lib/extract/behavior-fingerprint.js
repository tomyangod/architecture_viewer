'use strict';

/**
 * Behavior fingerprint — six-dimension set signature derived from impl-surface.
 *
 * Dimensions:
 *   callSet / throwSet / awaitSet / branches / returns / sinkSet
 *
 * Unlike impl.hash (token-level), this ignores rename/move/format noise:
 * only the behavioral sets matter. Sink detection is heuristic (name patterns)
 * and always carries a confidence field.
 */

const crypto = require('crypto');

const SINK_PATTERNS = [
  { kind: 'storage', confidence: 'medium', re: /^(save|insert|update|delete|upsert|write|create|remove|persist|flush|query|find(?:One|All|By)?|execute|exec|commit)$/i },
  { kind: 'http', confidence: 'medium', re: /^(fetch|axios|request|httpGet|httpPost|httpPut|httpPatch|httpDelete|getJson|postJson)$/i },
  { kind: 'messaging', confidence: 'medium', re: /^(publish|emit|send|enqueue|produce|dispatch|notify)$/i },
  { kind: 'storage', confidence: 'low', re: /(Repo|Repository|Dao|Mapper|Store|Db|Database)$/ },
  { kind: 'http', confidence: 'low', re: /^(get|post|put|patch)$/i }
];

function uniqSort(list) {
  return [...new Set((list || []).filter(Boolean).map(String))].sort();
}

function detectSinks(callSet) {
  const out = [];
  const seen = new Set();
  for (const name of callSet || []) {
    for (const pat of SINK_PATTERNS) {
      if (!pat.re.test(name)) continue;
      const key = pat.kind + ':' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, kind: pat.kind, confidence: pat.confidence });
      break;
    }
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return out;
}

function emptyFingerprint() {
  return {
    callSet: [],
    throwSet: [],
    awaitSet: [],
    branches: 0,
    returns: 0,
    sinkSet: [],
    hash: null
  };
}

/**
 * Build a behavior fingerprint from an impl-surface record.
 * @param {object|null} impl
 * @returns {object|null}
 */
function fingerprintFromImpl(impl) {
  if (!impl) return null;
  const control = impl.control || {};
  const callSet = uniqSort(impl.calls);
  const throwSet = uniqSort(impl.throws);
  const awaitSet = uniqSort(impl.awaits);
  const branches = (control.if || 0) + (control.loop || 0);
  const returns = control.return || 0;
  const sinkSet = detectSinks(callSet);
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({
      callSet, throwSet, awaitSet, branches, returns,
      sinkSet: sinkSet.map((s) => s.kind + ':' + s.name)
    }))
    .digest('hex')
    .slice(0, 16);
  return { callSet, throwSet, awaitSet, branches, returns, sinkSet, hash };
}

function attachBehaviorToImpl(impl) {
  if (!impl || !impl.hash) return impl;
  const behavior = fingerprintFromImpl(impl);
  if (!behavior) return impl;
  return Object.assign({}, impl, { behavior });
}

function sameFingerprint(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.hash === b.hash;
}

function setDelta(from, to) {
  const f = new Set(from || []);
  const t = new Set(to || []);
  return {
    added: [...t].filter((v) => !f.has(v)).sort(),
    removed: [...f].filter((v) => !t.has(v)).sort()
  };
}

function sinkKey(s) {
  return (s.kind || '?') + ':' + (s.name || '');
}

function collectBehaviorMap(graph) {
  const map = new Map();
  for (const n of (graph && graph.nodes) || []) {
    if (n.behavior && n.behavior.hash) {
      map.set(n.id, {
        id: n.id,
        name: n.name,
        kind: n.kind,
        path: n.path,
        line: n.line,
        owner: null,
        method: n.name,
        exported: n.exported !== false,
        fingerprint: n.behavior
      });
    } else if (n.impl) {
      const fp = n.impl.behavior || fingerprintFromImpl(n.impl);
      if (fp && fp.hash) {
        map.set(n.id, {
          id: n.id,
          name: n.name,
          kind: n.kind,
          path: n.path,
          line: n.line,
          owner: null,
          method: n.name,
          exported: n.exported !== false,
          fingerprint: fp
        });
      }
    }
    const methods = n.methodImpls || {};
    for (const [key, impl] of Object.entries(methods)) {
      if (!impl) continue;
      const fp = impl.behavior || fingerprintFromImpl(impl);
      if (!fp || !fp.hash) continue;
      map.set(n.id + '::' + key, {
        id: n.id,
        name: n.name,
        kind: n.kind,
        path: n.path,
        line: impl.line || n.line,
        owner: n.name,
        method: key,
        exported: n.exported !== false,
        fingerprint: fp
      });
    }
  }
  return map;
}

/**
 * Diff behavior fingerprints. Rename/move with identical fingerprint → no entry.
 * Format-only body edits that leave the six sets unchanged → no entry
 * (because fingerprint hash ignores token-level noise).
 */
function diffBehaviorFingerprints(baseGraph, headGraph, opts) {
  opts = opts || {};
  const base = collectBehaviorMap(baseGraph);
  const head = collectBehaviorMap(headGraph);
  const changes = [];

  // renamedNodes: oldId → newId style pairs from structural diff
  const renamePairs = new Map();
  for (const r of opts.renamedNodes || []) {
    if (r.from && r.to && r.from.id && r.to.id) {
      renamePairs.set(r.to.id, r.from.id);
      renamePairs.set(r.from.id, r.to.id);
    }
  }

  const matchedBase = new Set();

  for (const [key, h] of head) {
    let b = base.get(key);
    if (!b && h.id && renamePairs.has(h.id)) {
      const oldId = renamePairs.get(h.id);
      const altKey = key.includes('::') ? oldId + '::' + key.split('::').slice(1).join('::') : oldId;
      b = base.get(altKey) || base.get(oldId);
    }
    if (!b) continue;
    matchedBase.add(key);
    if (sameFingerprint(b.fingerprint, h.fingerprint)) continue;

    const bf = b.fingerprint;
    const hf = h.fingerprint;
    const call = setDelta(bf.callSet, hf.callSet);
    const thr = setDelta(bf.throwSet, hf.throwSet);
    const aw = setDelta(bf.awaitSet, hf.awaitSet);
    const sinksFrom = (bf.sinkSet || []).map(sinkKey);
    const sinksTo = (hf.sinkSet || []).map(sinkKey);
    const sink = setDelta(sinksFrom, sinksTo);

    changes.push({
      id: h.id,
      name: h.name,
      kind: h.kind,
      path: h.path || null,
      line: h.line || null,
      owner: h.owner,
      method: h.method,
      exported: h.exported !== false,
      from: bf,
      to: hf,
      addedCalls: call.added.slice(0, 12),
      removedCalls: call.removed.slice(0, 12),
      addedThrows: thr.added.slice(0, 12),
      removedThrows: thr.removed.slice(0, 12),
      addedAwaits: aw.added.slice(0, 12),
      removedAwaits: aw.removed.slice(0, 12),
      branchesFrom: bf.branches,
      branchesTo: hf.branches,
      returnsFrom: bf.returns,
      returnsTo: hf.returns,
      addedSinks: sink.added.slice(0, 12),
      removedSinks: sink.removed.slice(0, 12),
      sinkConfidence: (hf.sinkSet || []).map((s) => s.confidence).sort()[0] || null
    });
  }

  changes.sort((a, b) => String(a.path || '').localeCompare(String(b.path || ''))
    || String(a.method || '').localeCompare(String(b.method || '')));
  return changes;
}

function formatBehaviorSymbol(c) {
  return c.owner ? `${c.owner}.${c.method}` : (c.method || c.name || c.id);
}

function formatBehaviorDiffText(changes) {
  if (!changes || !changes.length) return '';
  const lines = ['--- 行为指纹差异（集合维度，不进结构指纹） ---'];
  for (const c of changes.slice(0, 40)) {
    const bits = [];
    if (c.addedCalls && c.addedCalls.length) bits.push('+call ' + c.addedCalls.join(', '));
    if (c.removedCalls && c.removedCalls.length) bits.push('-call ' + c.removedCalls.join(', '));
    if (c.addedThrows && c.addedThrows.length) bits.push('+throw ' + c.addedThrows.join(', '));
    if (c.removedThrows && c.removedThrows.length) bits.push('-throw ' + c.removedThrows.join(', '));
    if (c.addedAwaits && c.addedAwaits.length) bits.push('+await ' + c.addedAwaits.join(', '));
    if (c.removedAwaits && c.removedAwaits.length) bits.push('-await ' + c.removedAwaits.join(', '));
    if (c.branchesFrom !== c.branchesTo) bits.push(`branches ${c.branchesFrom}→${c.branchesTo}`);
    if (c.returnsFrom !== c.returnsTo) bits.push(`returns ${c.returnsFrom}→${c.returnsTo}`);
    if (c.addedSinks && c.addedSinks.length) bits.push('+sink ' + c.addedSinks.join(', '));
    if (c.removedSinks && c.removedSinks.length) bits.push('-sink ' + c.removedSinks.join(', '));
    const extra = bits.length ? '  ' + bits.join(' · ') : '';
    lines.push(`  ~ ${formatBehaviorSymbol(c)} ${c.path || ''}${extra}`);
  }
  if (changes.length > 40) lines.push(`  …另有 ${changes.length - 40} 个`);
  lines.push('  （未判定业务对错：指纹只标「干的事变了」，不验证算对了没有）');
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  fingerprintFromImpl,
  attachBehaviorToImpl,
  detectSinks,
  sameFingerprint,
  collectBehaviorMap,
  diffBehaviorFingerprints,
  formatBehaviorDiffText,
  formatBehaviorSymbol,
  emptyFingerprint,
  SINK_PATTERNS
};
