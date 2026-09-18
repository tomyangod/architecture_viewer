'use strict';

/**
 * Awareness layer (感知层) — sparse sensitive-surface cards for vibe-coder perception.
 *
 * Design (P0–P2):
 *  - Deterministic templates only (no LLM).
 *  - Default silent: most findings never become cards.
 *  - Whitelist: schema / signature-break / confirmed layer-skip / new external dep /
 *    newly added storage|http sinks (heuristic, labeled).
 *  - Does not affect gateLevel / exit codes.
 *  - Cursor (.av/awareness-cursor.json) stores lastSeenFingerprint, mutedRules, lastCardKeys
 *    so repeat identical cards stay quiet.
 *  - P2 portrait: entry + external deps + sink counts in the change closure
 *    (entity/layer names only — never invent feature-module labels).
 */

const fs = require('fs');
const path = require('path');

const CURSOR_FILE = 'awareness-cursor.json';
const CARD_CAP = 3;
const DAILY_L2_CAP = 3;
const ENTRY_LAYERS = new Set(['controller', 'entrypoint', 'component']);
const PORTRAIT_ENTRY_CAP = 5;
const PORTRAIT_EXT_CAP = 6;
const PORTRAIT_SINK_SAMPLE = 3;
const TYPE_KINDS = new Set([
  'class', 'interface', 'enum', 'record', 'annotation', 'function',
  'type_alias', 'component'
]);

// Allowed awareness rules for mute/unmute operations
const ALLOWED_MUTE_RULES = new Set([
  'schema-touched',
  'signature-break',
  'layer-skip',
  'new-external-dep',
  'sensitive-sink'
]);

const LEVEL_RANK = { L3: 0, L2: 1, L1: 2 };

function cursorPath(repo) {
  return path.join(repo, '.av', CURSOR_FILE);
}

function readCursor(repo) {
  try {
    const raw = JSON.parse(fs.readFileSync(cursorPath(repo), 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyCursor();
    return {
      version: 1,
      lastSeenFingerprint: raw.lastSeenFingerprint || null,
      lastSeenAt: raw.lastSeenAt || null,
      mutedRules: Array.isArray(raw.mutedRules) ? raw.mutedRules.map(String) : [],
      lastCardKeys: Array.isArray(raw.lastCardKeys) ? raw.lastCardKeys.map(String) : [],
      l2ShownOn: raw.l2ShownOn || null,
      l2ShownCount: Number(raw.l2ShownCount) || 0
    };
  } catch {
    return emptyCursor();
  }
}

function emptyCursor() {
  return {
    version: 1,
    lastSeenFingerprint: null,
    lastSeenAt: null,
    mutedRules: [],
    lastCardKeys: [],
    l2ShownOn: null,
    l2ShownCount: 0
  };
}

function writeCursor(repo, patch) {
  const prev = readCursor(repo);
  const next = { ...prev, ...patch, version: 1 };
  fs.mkdirSync(path.join(repo, '.av'), { recursive: true });
  fs.writeFileSync(cursorPath(repo), JSON.stringify(next, null, 2));
  return next;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function cardKey(card) {
  return [card.rule, card.level, card.file || '', card.line != null ? card.line : '', card.message || ''].join('|');
}

function isMuted(rule, mutedRules) {
  if (!rule || !mutedRules || !mutedRules.length) return false;
  return mutedRules.includes(rule) || mutedRules.includes('*');
}

function layerSkipEligible(finding) {
  if (!finding || finding.rule !== 'layer-skip') return false;
  // Unconfirmed layers are review hints only — never escalate to awareness L3.
  return finding.layerConfirmation === 'configured' && !finding.reportOnly;
}

function templateForFinding(finding) {
  if (!finding || !finding.rule) return null;
  const rule = finding.rule;
  const file = finding.file || null;
  const line = finding.line != null ? finding.line : null;
  const where = file ? (line != null ? `${file}:${line}` : file) : null;

  if (rule === 'schema-touched') {
    return {
      rule,
      level: 'L3',
      title: '数据契约变了',
      message: where
        ? `数据表/契约文件被改了（${where}）。启发式提示，未判定业务对错。`
        : '数据表/契约文件被改了。启发式提示，未判定业务对错。',
      file,
      line,
      heuristic: false
    };
  }

  if (rule === 'signature-break' && finding.severity === 'high') {
    return {
      rule,
      level: 'L3',
      title: '对外签名可能对不上',
      message: where
        ? `导出签名变了，已解析到的调用点可能对不上（${where}）。只覆盖静态 call 边。`
        : '导出签名变了，已解析到的调用点可能对不上。只覆盖静态 call 边。',
      file,
      line,
      heuristic: false
    };
  }

  if (layerSkipEligible(finding)) {
    const from = finding.fromLayer || '?';
    const to = finding.toLayer || '?';
    return {
      rule,
      level: 'L3',
      title: '入口直接碰到存储层',
      message: where
        ? `分层已确认：${from} → ${to} 跳层（${where}）。`
        : `分层已确认：${from} → ${to} 跳层。`,
      file,
      line,
      heuristic: false
    };
  }

  if (rule === 'new-external-dep' && finding.severity !== 'info') {
    return {
      rule,
      level: 'L2',
      title: '接了新的外部依赖',
      message: finding.message || '本轮引入了新的第三方包。',
      file: finding.detail || null,
      line: null,
      heuristic: false
    };
  }

  return null;
}

function sinkCardsFromDiff(diff) {
  const out = [];
  const seen = new Set();
  for (const c of (diff && diff.behaviorChanges) || []) {
    for (const sink of c.addedSinks || []) {
      const kind = String(sink).split(':')[0];
      const name = String(sink).includes(':') ? String(sink).slice(String(sink).indexOf(':') + 1) : String(sink);
      if (kind !== 'storage' && kind !== 'http') continue;
      const key = `${c.path || c.id}|${kind}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const who = c.owner ? `${c.owner}.${c.method || c.name}` : (c.method || c.name || c.id);
      out.push({
        rule: 'sensitive-sink',
        level: 'L2',
        title: kind === 'storage' ? '新增写库/存储调用' : '新增外部 HTTP 调用',
        message: `"${who}" 新增 ${kind} sink「${name}」（命名启发式，confidence 见行为指纹）。未判定业务对错。`,
        file: c.path || null,
        line: c.line != null ? c.line : null,
        heuristic: true,
        sinkKind: kind,
        sinkName: name
      });
    }
  }
  return out;
}

function collectCandidateCards(findings, diff, mutedRules) {
  const cards = [];
  for (const f of findings || []) {
    if (isMuted(f.rule, mutedRules)) continue;
    const card = templateForFinding(f);
    if (card) cards.push(card);
  }
  for (const card of sinkCardsFromDiff(diff)) {
    if (isMuted(card.rule, mutedRules)) continue;
    cards.push(card);
  }
  cards.sort((a, b) => {
    const lr = (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9);
    if (lr !== 0) return lr;
    return String(a.rule).localeCompare(String(b.rule))
      || String(a.file || '').localeCompare(String(b.file || ''));
  });
  return cards;
}

function nodeStatus(id, sets) {
  if (sets.added.has(id)) return 'added';
  if (sets.removed.has(id)) return 'removed';
  if (sets.modified.has(id)) return 'modified';
  if (sets.moved.has(id)) return 'moved';
  if (sets.renamed.has(id)) return 'renamed';
  return 'unchanged';
}

function changeIdSets(diff) {
  const added = new Set((diff.addedNodes || []).map((n) => (n.node || n).id).filter(Boolean));
  const removed = new Set((diff.removedNodes || []).map((n) => (n.node || n).id).filter(Boolean));
  const modified = new Set((diff.modifiedNodes || []).map((n) => (n.node || n).id || n.id).filter(Boolean));
  const moved = new Set((diff.movedNodes || []).map((n) => (n.node || n).id || n.id).filter(Boolean));
  const renamed = new Set();
  for (const r of diff.renamedNodes || []) {
    if (r.to && r.to.id) renamed.add(r.to.id);
    if (r.from && r.from.id) renamed.add(r.from.id);
    if (r.id) renamed.add(r.id);
  }
  return { added, removed, modified, moved, renamed };
}

function extName(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.replace(/^ext:/, '');
  return d.name || String(d.id || '').replace(/^ext:/, '') || null;
}

/**
 * Sparse change portrait — counts and entity names only.
 * No invented domain/"支付模块" labels.
 */
function buildSparsePortrait(opts = {}) {
  const diff = opts.diff || {};
  const headGraph = opts.headGraph || null;
  const sets = changeIdSets(diff);
  const changedIds = new Set([
    ...sets.added, ...sets.removed, ...sets.modified, ...sets.moved, ...sets.renamed
  ]);

  const entries = [];
  const layerCounts = new Map();
  const nodes = (headGraph && headGraph.nodes) || [];
  // Also consider removed nodes from diff for entries/layers
  const removedNodes = (diff.removedNodes || []).map((n) => n.node || n);
  const seenEntry = new Set();

  function considerNode(node, forceStatus) {
    if (!node || !node.id) return;
    if (!TYPE_KINDS.has(node.kind) && node.kind !== 'file') return;
    const inChange = changedIds.has(node.id) || forceStatus;
    if (!inChange) return;
    if (TYPE_KINDS.has(node.kind) && node.layer) {
      layerCounts.set(node.layer, (layerCounts.get(node.layer) || 0) + 1);
    }
    if (!ENTRY_LAYERS.has(node.layer)) return;
    if (node.kind === 'file') return;
    if (seenEntry.has(node.id)) return;
    seenEntry.add(node.id);
    entries.push({
      name: node.name || node.id,
      layer: node.layer,
      path: node.path || null,
      status: forceStatus || nodeStatus(node.id, sets)
    });
  }

  for (const n of nodes) considerNode(n);
  for (const n of removedNodes) considerNode(n, 'removed');

  entries.sort((a, b) =>
    String(a.layer).localeCompare(String(b.layer))
    || String(a.name).localeCompare(String(b.name)));
  const entryList = entries.slice(0, PORTRAIT_ENTRY_CAP);

  const addedExt = (diff.addedExternalDeps || [])
    .map(extName).filter(Boolean);
  const removedExt = (diff.removedExternalDeps || [])
    .map(extName).filter(Boolean);

  const sinkCounts = { storage: 0, http: 0, messaging: 0 };
  const sinkSamples = [];
  for (const c of diff.behaviorChanges || []) {
    for (const sink of c.addedSinks || []) {
      const kind = String(sink).split(':')[0];
      const name = String(sink).includes(':')
        ? String(sink).slice(String(sink).indexOf(':') + 1)
        : String(sink);
      if (!Object.prototype.hasOwnProperty.call(sinkCounts, kind)) continue;
      sinkCounts[kind]++;
      if (sinkSamples.length < PORTRAIT_SINK_SAMPLE) {
        const who = c.owner
          ? `${c.owner}.${c.method || c.name || ''}`.replace(/\.$/, '')
          : (c.method || c.name || c.id || '?');
        sinkSamples.push({
          who,
          kind,
          name,
          path: c.path || null
        });
      }
    }
  }

  const layersTouched = [...layerCounts.entries()]
    .map(([layer, count]) => ({ layer, count }))
    .sort((a, b) => b.count - a.count || a.layer.localeCompare(b.layer));

  const sinkTotal = sinkCounts.storage + sinkCounts.http + sinkCounts.messaging;
  const empty = entryList.length === 0
    && addedExt.length === 0
    && removedExt.length === 0
    && sinkTotal === 0
    && layersTouched.length === 0;

  const bits = [];
  if (entryList.length) bits.push(`入口 ${entryList.length}`);
  if (addedExt.length || removedExt.length) {
    const parts = [];
    if (addedExt.length) parts.push(`+${addedExt.length}`);
    if (removedExt.length) parts.push(`-${removedExt.length}`);
    bits.push(`外依 ${parts.join('/')}`);
  }
  if (sinkCounts.storage) bits.push(`写库 ${sinkCounts.storage}`);
  if (sinkCounts.http) bits.push(`HTTP ${sinkCounts.http}`);
  if (sinkCounts.messaging) bits.push(`消息 ${sinkCounts.messaging}`);
  if (!bits.length && layersTouched.length) {
    bits.push(`触及层 ${layersTouched.map((l) => `${l.layer}:${l.count}`).slice(0, 4).join(' ')}`);
  }

  return {
    empty,
    entries: entryList,
    entriesOmitted: Math.max(0, entries.length - entryList.length),
    external: {
      added: addedExt.slice(0, PORTRAIT_EXT_CAP),
      removed: removedExt.slice(0, PORTRAIT_EXT_CAP),
      addedOmitted: Math.max(0, addedExt.length - PORTRAIT_EXT_CAP),
      removedOmitted: Math.max(0, removedExt.length - PORTRAIT_EXT_CAP)
    },
    sinks: {
      ...sinkCounts,
      total: sinkTotal,
      samples: sinkSamples
    },
    layersTouched,
    summaryLine: bits.length ? bits.join(' · ') : null
  };
}

/**
 * Build awareness payload for a session report.
 * @param {object} opts
 * @param {Array} [opts.findings]
 * @param {object} [opts.diff]
 * @param {object} [opts.headGraph] for P2 portrait entries/layers
 * @param {string} [opts.repo] for cursor read
 * @param {object} [opts.cursor] override cursor (tests)
 * @param {string[]} [opts.mutedRules]
 * @param {number} [opts.maxCards=3]
 * @param {boolean} [opts.ignoreLastCards=false] tests: do not suppress repeats
 */
function buildAwareness(opts = {}) {
  const cursor = opts.cursor || (opts.repo ? readCursor(opts.repo) : emptyCursor());
  const muted = opts.mutedRules != null ? opts.mutedRules : cursor.mutedRules;
  const maxCards = opts.maxCards != null ? opts.maxCards : CARD_CAP;
  const all = collectCandidateCards(opts.findings, opts.diff, muted);
  const lastKeys = new Set(opts.ignoreLastCards ? [] : (cursor.lastCardKeys || []));

  const fresh = [];
  const repeats = [];
  for (const card of all) {
    const key = cardKey(card);
    card.key = key;
    if (lastKeys.has(key)) repeats.push(card);
    else fresh.push(card);
  }

  // Daily L2 soft cap (does not drop L3).
  let l2Budget = DAILY_L2_CAP;
  const day = todayUtc();
  if (cursor.l2ShownOn === day) {
    l2Budget = Math.max(0, DAILY_L2_CAP - (cursor.l2ShownCount || 0));
  }
  const selected = [];
  let l2Used = 0;
  for (const card of fresh) {
    if (selected.length >= maxCards) break;
    if (card.level === 'L2') {
      if (l2Used >= l2Budget) continue;
      l2Used++;
    }
    selected.push(card);
  }

  const level = selected.some((c) => c.level === 'L3')
    ? 'L3'
    : (selected.some((c) => c.level === 'L2') ? 'L2' : 'L1');
  const silent = selected.length === 0;
  const portrait = buildSparsePortrait({
    diff: opts.diff,
    headGraph: opts.headGraph
  });

  return {
    version: 1,
    silent,
    level,
    cards: selected,
    portrait,
    stats: {
      candidates: all.length,
      fresh: fresh.length,
      repeats: repeats.length,
      muted: muted.length,
      l2Budget,
      l2Used
    },
    disclaimer: '感知层只标敏感面结构事实（模板）。静默默认；不判定业务对错；不进入架构门禁退出码。稀疏画像只计入口/外依/副作用，不发明功能模块名。'
  };
}

function formatAwarenessLine(awareness) {
  if (!awareness || awareness.silent || !(awareness.cards || []).length) return null;
  const n = awareness.cards.length;
  const head = awareness.cards[0];
  const more = n > 1 ? ` 等 ${n} 处` : '';
  let line = `感知 · ${head.title}${more}：${head.message}`;
  if (head.walkOrder != null) line += ` · 走查第 ${head.walkOrder} 步`;
  return line;
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function fileMatches(cardFile, stepPath) {
  if (!cardFile || !stepPath) return false;
  const a = normPath(cardFile);
  const b = normPath(stepPath);
  if (a === b) return true;
  // Path-boundary aware: only match on '/' separator or full path equality
  // to avoid false positives like 'a.js' matching 'data.js'
  return a.endsWith('/' + b) || b.endsWith('/' + a);
}

function matchWalkStep(card, steps) {
  let best = null;
  let bestScore = 0;
  for (const step of steps || []) {
    let score = 0;
    const fileMatch = fileMatches(card.file, step.path);
    if (fileMatch) score += 10;
    // Only consider line match if file also matches (prevent cross-file line number collisions)
    if (fileMatch && card.line != null && step.line != null && Number(card.line) === Number(step.line)) score += 5;
    if (card.rule === 'layer-skip' && step.layerSkip) score += 8;
    if (card.rule === 'sensitive-sink') {
      const hit = (step.sinks || []).some((s) =>
        s.kind === card.sinkKind && (!card.sinkName || s.name === card.sinkName));
      if (hit) score += 12;
    }
    if (score > bestScore) {
      bestScore = score;
      best = step;
    }
  }
  return best;
}

/**
 * Attach Review Walk / file:line evidence onto cards (mutates awareness).
 * Call after both buildAwareness and buildReviewWalk.
 */
function attachAwarenessEvidence(awareness, reviewWalk) {
  if (!awareness || !Array.isArray(awareness.cards)) return awareness;
  const steps = (reviewWalk && reviewWalk.steps) || [];
  for (const card of awareness.cards) {
    const step = matchWalkStep(card, steps);
    if (step) {
      card.walkOrder = step.order;
      card.walkAnchor = `walk-step-${step.order}`;
      card.walkName = step.name || step.id || null;
    }
    card.where = card.file
      ? (card.line != null ? `${card.file}:${card.line}` : card.file)
      : null;
  }
  return awareness;
}

/**
 * Persist cursor after the user has been shown a report/guard result.
 */
function markAwarenessSeen(repo, opts = {}) {
  const awareness = opts.awareness || null;
  const headFingerprint = opts.headFingerprint || null;
  const prev = readCursor(repo);
  const day = todayUtc();
  const shownL2 = (awareness && awareness.cards || []).filter((c) => c.level === 'L2').length;
  let l2ShownOn = prev.l2ShownOn;
  let l2ShownCount = prev.l2ShownCount || 0;
  if (shownL2 > 0) {
    if (l2ShownOn === day) l2ShownCount += shownL2;
    else {
      l2ShownOn = day;
      l2ShownCount = shownL2;
    }
  }
  const keys = (awareness && awareness.cards || []).map((c) => c.key || cardKey(c));
  const mergedKeys = [...new Set([...(prev.lastCardKeys || []), ...keys])].slice(-40);
  return writeCursor(repo, {
    lastSeenFingerprint: headFingerprint || prev.lastSeenFingerprint,
    lastSeenAt: new Date().toISOString(),
    lastCardKeys: mergedKeys,
    l2ShownOn,
    l2ShownCount,
    mutedRules: prev.mutedRules
  });
}

function muteAwarenessRule(repo, rule) {
  if (!rule) return readCursor(repo);
  const ruleStr = String(rule);
  if (!ALLOWED_MUTE_RULES.has(ruleStr)) {
    throw new Error(`Unknown rule "${ruleStr}". Allowed: ${Array.from(ALLOWED_MUTE_RULES).join(', ')}`);
  }
  const prev = readCursor(repo);
  const muted = [...new Set([...(prev.mutedRules || []), ruleStr])];
  return writeCursor(repo, { mutedRules: muted });
}

function unmuteAwarenessRule(repo, rule) {
  if (!rule) return readCursor(repo);
  const want = String(rule);
  if (!ALLOWED_MUTE_RULES.has(want)) {
    throw new Error(`Unknown rule "${want}". Allowed: ${Array.from(ALLOWED_MUTE_RULES).join(', ')}`);
  }
  const prev = readCursor(repo);
  const muted = (prev.mutedRules || []).filter((r) => r !== want);
  return writeCursor(repo, { mutedRules: muted });
}

module.exports = {
  buildAwareness,
  buildSparsePortrait,
  formatAwarenessLine,
  attachAwarenessEvidence,
  readCursor,
  writeCursor,
  markAwarenessSeen,
  muteAwarenessRule,
  unmuteAwarenessRule,
  cardKey,
  CURSOR_FILE,
  CARD_CAP,
  DAILY_L2_CAP,
  ALLOWED_MUTE_RULES
};
