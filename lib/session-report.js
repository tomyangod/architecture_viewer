'use strict';

/**
 * Session report generator — self-contained offline HTML with
 * Before / Delta / After layered architecture diagrams and risk findings.
 *
 * Delta panel (Archify-inspired): only changed entities/edges —
 * added, removed, modified, moved, renamed, rerouted, violations.
 */

const fs = require('fs');
const path = require('path');
const { layerLabel, LAYER_RANK } = require('./risk-rules');

// Layer display order (top to bottom in the diagram)
const LAYER_ORDER = ['component', 'controller', 'service', 'domain', 'storage', 'dto', 'config', 'util'];
const LAYER_COLORS = {
  component: '#8b5cf6',
  controller: '#3b82f6',
  service: '#10b981',
  domain: '#f59e0b',
  storage: '#ef4444',
  dto: '#6b7280',
  config: '#ec4899',
  util: '#64748b',
  undefined: '#94a3b8',
  '未分类': '#94a3b8'
};

const ARCH_EDGE_TYPES = ['import', 'extends', 'implements', 'field-type', 'method-param', 'method-return', 'component-props'];
const TYPE_KINDS = ['class', 'interface', 'enum', 'record', 'annotation', 'function', 'type_alias', 'component'];

/**
 * Generate the HTML session report.
 * @param {object} opts
 * @param {object} opts.baseGraph - graph before changes
 * @param {object} opts.headGraph - graph after changes
 * @param {object} opts.diff - diffGraphs result
 * @param {Array} opts.findings - risk findings
 * @param {string} opts.repoName - repository name
 * @param {string} opts.sessionStart - ISO timestamp of session start
 * @returns {string} complete HTML document
 */
function generateReport({ baseGraph, headGraph, diff, findings, impact, repoName, sessionStart }) {
  const payload = buildReportData(baseGraph, headGraph, diff, findings, impact, repoName, sessionStart);
  const { assertReportContract } = require('./report-contract');
  assertReportContract(payload);
  return renderHtml(payload);
}

/**
 * Build the compact data payload embedded in the HTML.
 */
function buildReportData(baseGraph, headGraph, headDiff, findings, impact, repoName, sessionStart) {
  const baseNodeMap = new Map(baseGraph.nodes.map((n) => [n.id, n]));
  const headNodeMap = new Map(headGraph.nodes.map((n) => [n.id, n]));

  // Collect entity nodes (architectural types, not files/externals)
  const addedIds = new Set(headDiff.addedNodes.map((n) => n.id));
  const modifiedIds = new Set(headDiff.modifiedNodes.map((n) => n.id));
  const movedIds = new Set((headDiff.movedNodes || []).map((n) => n.id));
  const renamedIds = new Set();
  for (const r of headDiff.renamedNodes || []) {
    if (r.from && r.from.id) renamedIds.add(r.from.id);
    if (r.to && r.to.id) renamedIds.add(r.to.id);
  }
  // High-signal statuses (anything but 'unchanged') are expanded by default;
  // unchanged entities are folded in the default graph filter.
  const statusOf = (id) => addedIds.has(id) ? 'added'
    : renamedIds.has(id) ? 'renamed'
    : modifiedIds.has(id) ? 'modified'
    : movedIds.has(id) ? 'moved'
    : 'unchanged';

  // Build a unified entity list (entities present in either graph)
  const entityMap = new Map();
  for (const n of headGraph.nodes) {
    if (!TYPE_KINDS.includes(n.kind)) continue;
    entityMap.set(n.id, {
      id: n.id,
      name: n.name,
      kind: n.kind,
      layer: n.layer || null,
      lang: n.lang,
      path: n.path,
      methods: n.methods || [],
      status: statusOf(n.id)
    });
  }
  for (const n of baseGraph.nodes) {
    if (!TYPE_KINDS.includes(n.kind)) continue;
    if (entityMap.has(n.id)) continue;
    entityMap.set(n.id, {
      id: n.id,
      name: n.name,
      kind: n.kind,
      layer: n.layer || null,
      lang: n.lang,
      path: n.path,
      methods: n.methods || [],
      status: renamedIds.has(n.id) ? 'renamed' : 'removed'
    });
  }

  // Build edges (only architectural types, between entities)
  const edgeMap = new Map();
  function edgeKey(e) { return `${e.from}|${e.type}|${e.to}`; }

  for (const e of headGraph.edges) {
    if (!ARCH_EDGE_TYPES.includes(e.type)) continue;
    const from = headNodeMap.get(e.from);
    const to = headNodeMap.get(e.to);
    if (!from || !to) continue;
    if (!TYPE_KINDS.includes(from.kind) || !TYPE_KINDS.includes(to.kind)) continue;
    edgeMap.set(edgeKey(e), {
      from: e.from, to: e.to, type: e.type,
      method: e.method || null, field: e.field || null,
      status: 'unchanged'
    });
  }
  for (const e of baseGraph.edges) {
    if (!ARCH_EDGE_TYPES.includes(e.type)) continue;
    const key = edgeKey(e);
    if (edgeMap.has(key)) continue;
    const from = baseNodeMap.get(e.from);
    const to = baseNodeMap.get(e.to);
    if (!from || !to) continue;
    if (!TYPE_KINDS.includes(from.kind) || !TYPE_KINDS.includes(to.kind)) continue;
    edgeMap.set(key, {
      from: e.from, to: e.to, type: e.type,
      method: e.method || null, field: e.field || null,
      status: 'removed'
    });
  }

  // Mark added edges
  for (const ae of headDiff.addedEdges) {
    const key = edgeKey(ae);
    if (edgeMap.has(key)) edgeMap.get(key).status = 'added';
  }

  // Rerouted: show as a synthetic edge on the head type, flagged rerouted
  for (const re of headDiff.reroutedEdges || []) {
    const headKey = `${re.from}|${re.toType}|${re.to}`;
    if (edgeMap.has(headKey)) {
      edgeMap.get(headKey).status = 'rerouted';
      edgeMap.get(headKey).fromType = re.fromType;
    } else {
      edgeMap.set(headKey, {
        from: re.from, to: re.to, type: re.toType,
        fromType: re.fromType,
        method: null, field: null,
        status: 'rerouted'
      });
    }
  }

  // Violation edge keys
  const violationKeys = new Set();
  for (const v of headDiff.violations) {
    violationKeys.add(`${v.from}|${v.edgeType}|${v.to}`);
  }

  // --- File-level import edges (file → file) ---
  // Dynamic languages (JS/Python) rarely produce entity-level edges; import
  // dependencies live at file granularity. Surface added/removed/violation
  // file edges so the Delta graph agrees with the top stats and findings —
  // otherwise a file-level cross-layer violation lights a red finding while
  // the graph shows "0 edges / 无结构变化". Only structurally-interesting file
  // edges are injected (not every import), so the graph stays scoped to the
  // change set.
  const FILE_KIND = 'file';
  const lookupNode = (id) => headNodeMap.get(id) || baseNodeMap.get(id);
  const isFileEndpoint = (id) => {
    const n = lookupNode(id);
    return !!n && n.kind === FILE_KIND;
  };
  const ensureFileNode = (id) => {
    if (entityMap.has(id)) return;
    const n = lookupNode(id);
    if (!n || n.kind !== FILE_KIND) return;
    entityMap.set(id, {
      id: n.id,
      name: n.name,
      kind: FILE_KIND,
      layer: n.layer || null,
      lang: n.lang,
      path: n.path,
      methods: [],
      status: headNodeMap.has(id) ? statusOf(id) : 'removed'
    });
  };
  const fileEdgeSeen = new Set();
  function considerFileEdge(rawEdge, status) {
    if (!rawEdge || rawEdge.type !== 'import') return;
    if (!isFileEndpoint(rawEdge.from) || !isFileEndpoint(rawEdge.to)) return; // entity-level edges handled above
    const key = edgeKey(rawEdge);
    if (fileEdgeSeen.has(key)) return;
    fileEdgeSeen.add(key);
    ensureFileNode(rawEdge.from);
    ensureFileNode(rawEdge.to);
    if (edgeMap.has(key)) {
      // Keep the stronger status: added/removed beats unchanged.
      const cur = edgeMap.get(key);
      if (cur.status === 'unchanged' && status !== 'unchanged') cur.status = status;
      return;
    }
    edgeMap.set(key, {
      from: rawEdge.from, to: rawEdge.to, type: rawEdge.type,
      method: null, field: null, status
    });
  }
  for (const e of headDiff.addedEdges) considerFileEdge(e, 'added');
  for (const e of headDiff.removedEdges) considerFileEdge(e, 'removed');
  for (const v of headDiff.violations) {
    considerFileEdge({ from: v.from, to: v.to, type: v.edgeType }, 'unchanged');
  }

  const entities = Array.from(entityMap.values());
  const edges = Array.from(edgeMap.values()).map((e) => ({
    ...e,
    violation: violationKeys.has(edgeKey(e))
  }));

  // Modified entities (method changes)
  const modified = headDiff.modifiedNodes.map((m) => {
    const node = headNodeMap.get(m.id) || baseNodeMap.get(m.id);
    return {
      id: m.id,
      name: node?.name || m.id,
      kind: node?.kind || '?',
      layer: node?.layer || '未分类',
      changes: m.changes.map((c) => ({
        field: c.field,
        added: c.added || null,
        removed: c.removed || null,
        from: c.from || null,
        to: c.to || null
      }))
    };
  });

  const moved = (headDiff.movedNodes || []).map((m) => {
    const node = headNodeMap.get(m.id) || baseNodeMap.get(m.id);
    return {
      id: m.id,
      name: node?.name || m.id,
      kind: node?.kind || '?',
      changes: m.changes.map((c) => ({ field: c.field, from: c.from, to: c.to }))
    };
  });

  // Renamed entities (paired removed+added in the text diff).
  // moved=true pairs are cross-directory file moves (same name, new path).
  const renamed = (headDiff.renamedNodes || []).map((r) => ({
    oldName: r.oldName,
    newName: r.newName,
    kind: r.kind,
    path: r.path,
    moved: !!r.moved,
    fromPath: r.fromPath || r.path,
    toPath: r.toPath || r.path
  }));

  const rerouted = (headDiff.reroutedEdges || []).map((e) => ({
    from: e.from,
    to: e.to,
    fromType: e.fromType,
    toType: e.toType
  }));

  // External dep changes
  const extAdded = headDiff.addedExternalDeps.map((d) => ({ name: d.name || d.id.replace('ext:', ''), builtin: d.builtin }));
  const extRemoved = headDiff.removedExternalDeps.map((d) => ({ name: d.name || d.id.replace('ext:', ''), builtin: d.builtin }));

  const structure = buildStructure(baseGraph, headGraph, headDiff);

  return {
    schemaVersion: 1,
    repo: repoName,
    generatedAt: new Date().toISOString(),
    sessionStart: sessionStart || null,
    baseFingerprint: baseGraph.fingerprint,
    headFingerprint: headGraph.fingerprint,
    summary: headDiff.summary,
    risk: {
      level: findings.length ? findings[0].severity : 'none',
      findings: findings.map((f) => ({
        rule: f.rule,
        severity: f.severity,
        title: f.title,
        message: f.message,
        detail: f.detail || null,
        file: f.file || null,
        line: f.line || null
      }))
    },
    impact: impact && impact.items && impact.items.length ? {
      changedCount: impact.changedCount,
      impactedCount: impact.impactedCount,
      items: impact.items.map((it) => ({
        label: it.label,
        name: it.node.name || it.id,
        path: it.node.path || '',
        kind: it.node.kind,
        directCount: it.direct.length,
        transitiveCount: it.transitive.length,
        direct: it.direct.slice(0, 8).map((d) => ({ name: d.name || d.id, layer: d.layer || '', path: d.path || '' }))
      }))
    } : null,
    stats: {
      base: baseGraph.stats,
      head: headGraph.stats
    },
    layers: LAYER_ORDER,
    entities,
    edges,
    modified,
    moved,
    renamed,
    rerouted,
    extAdded,
    extRemoved,
    fileLocMap: buildFileLocMap(headDiff),
    structure
  };
}

/** Badge text for a file's line-count change. Empty when baseline has no LOC (avoid fake +100%). */
function formatFileLocLabel(loc) {
  if (!loc || !(loc.base > 0) || !(loc.delta > 0)) return '';
  const pct = loc.deltaPercent ? ` · +${Math.round(loc.deltaPercent)}%` : '';
  return `+${loc.delta}行${pct}`;
}

/** Delta file-box severity: only when baseline LOC exists. */
function fileLocSeverity(loc) {
  if (!loc || !(loc.base > 0) || !(loc.delta > 0)) return '';
  if (loc.delta >= 300 || loc.deltaPercent >= 100) return 'growth-med';
  if (loc.delta >= 150 || loc.deltaPercent >= 40) return 'growth';
  return '';
}

function buildFileLocMap(diff) {
  if (!diff.fileLocChanges || !diff.fileLocChanges.length) return {};
  const map = {};
  for (const f of diff.fileLocChanges) {
    const loc = { base: f.baseLoc, head: f.headLoc, delta: f.delta, deltaPercent: f.deltaPercent };
    loc.label = formatFileLocLabel(loc);
    loc.severity = fileLocSeverity(loc);
    map[f.path] = loc;
  }
  return map;
}

/** 文件在结构清单中的排序权重：变更文件排前，保证截断时变化不丢。 */
const STRUCTURE_STATUS_RANK = { added: 0, removed: 1, modified: 2, unchanged: 3 };

/** 结构清单文件数上限（超出后变更文件优先保留，其余截断）。 */
const STRUCTURE_FILE_CAP = 300;

/**
 * 项目结构快照：全量文件清单（路径 / 层 / 语言 / 行数 / 本轮状态）+ 全量外部依赖。
 * 数据来自底层图的 file / external 节点——报告图只画类型实体，
 * 这里补齐“整个项目有哪些文件、目录、依赖”的全貌视图。
 */
function buildStructure(baseGraph, headGraph, diff) {
  const headFiles = new Map();
  const baseFiles = new Map();
  for (const n of headGraph.nodes) {
    if (n.kind === 'file') headFiles.set(n.path, n);
  }
  for (const n of baseGraph.nodes) {
    if (n.kind === 'file') baseFiles.set(n.path, n);
  }
  const locByPath = new Map((diff.fileLocChanges || []).map((f) => [f.path, f]));
  const allPaths = new Set([...headFiles.keys(), ...baseFiles.keys()]);
  let files = [];
  for (const p of allPaths) {
    const h = headFiles.get(p);
    const b = baseFiles.get(p);
    const loc = locByPath.get(p);
    let status = 'unchanged';
    if (h && !b) status = 'added';
    else if (b && !h) status = 'removed';
    else if (loc && loc.delta !== 0) status = 'modified';
    const node = h || b;
    files.push({
      path: p,
      layer: node.layer || '',
      lang: node.lang || '',
      lines: h ? (h.lineCount || 0) : (b.lineCount || 0),
      delta: loc ? loc.delta : 0,
      status
    });
  }
  files.sort((a, b) =>
    (STRUCTURE_STATUS_RANK[a.status] ?? 9) - (STRUCTURE_STATUS_RANK[b.status] ?? 9) ||
    a.path.localeCompare(b.path));
  const totalFiles = files.length;
  const truncated = totalFiles > STRUCTURE_FILE_CAP;
  if (truncated) files = files.slice(0, STRUCTURE_FILE_CAP);

  // 外部依赖全貌：当前存在的全部依赖 + 本轮新增/删除标记
  const deps = new Map();
  const isExt = (n) => n.kind === 'external' || n.kind === 'external-package';
  const depName = (id, fallback) => fallback || String(id).replace(/^ext:/, '');
  for (const n of headGraph.nodes) {
    if (!isExt(n)) continue;
    deps.set(n.id, { name: depName(n.id, n.name), builtin: !!n.builtin, status: 'unchanged' });
  }
  for (const d of diff.addedExternalDeps || []) {
    const existing = deps.get(d.id);
    if (existing) existing.status = 'added';
    else deps.set(d.id, { name: depName(d.id, d.name), builtin: !!d.builtin, status: 'added' });
  }
  for (const d of diff.removedExternalDeps || []) {
    if (!deps.has(d.id)) {
      deps.set(d.id, { name: depName(d.id, d.name), builtin: !!d.builtin, status: 'removed' });
    }
  }
  const depList = [...deps.values()].sort((a, b) =>
    (STRUCTURE_STATUS_RANK[a.status] ?? 9) - (STRUCTURE_STATUS_RANK[b.status] ?? 9) ||
    a.name.localeCompare(b.name));

  return { files, deps: depList, totalFiles, truncated };
}

function renderHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!-- Generated by Trae Work -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- 报告为固定路径静态文件且每次重新生成，禁止缓存，避免浏览器继续渲染旧版报告 -->
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>架构变更报告 — ${esc(data.repo)}</title>
<style>
${getStyles()}
</style>
</head>
<body>
<div id="app"></div>
<script>
const REPORT_DATA = ${json};
${getAppScript()}
</script>
</body>
</html>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getStyles() {
  return `
:root {
  --bg: #0f1117;
  --surface: #181b24;
  --surface2: #1f2330;
  --border: #2a2f3d;
  --text: #e4e7ec;
  --text2: #9ca3af;
  --text3: #6b7280;
  --green: #22c55e;
  --green-bg: rgba(34,197,94,.12);
  --red: #ef4444;
  --red-bg: rgba(239,68,68,.12);
  --orange: #f97316;
  --orange-bg: rgba(249,115,22,.12);
  --blue: #3b82f6;
  --purple: #8b5cf6;
  --yellow: #eab308;
  --cyan: #06b6d4;
  --mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans CJK SC', sans-serif;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--bg); color:var(--text); font-family:var(--sans); font-size:14px; line-height:1.6; }
#app { max-width:1480px; margin:0 auto; padding:32px 24px 80px; }

/* Header */
.header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:28px; flex-wrap:wrap; gap:16px; }
.header h1 { font-size:24px; font-weight:700; letter-spacing:-.02em; }
.header .sub { color:var(--text2); font-size:13px; margin-top:4px; }
.header .sub code { font-family:var(--mono); font-size:12px; color:var(--text3); }
.risk-badge { display:inline-flex; align-items:center; gap:8px; padding:8px 18px; border-radius:8px; font-weight:700; font-size:15px; letter-spacing:.02em; }
.risk-badge.high { background:var(--red-bg); color:var(--red); border:1px solid rgba(239,68,68,.3); }
.risk-badge.medium { background:var(--orange-bg); color:var(--orange); border:1px solid rgba(249,115,22,.3); }
.risk-badge.low { background:rgba(59,130,246,.12); color:var(--blue); border:1px solid rgba(59,130,246,.3); }
.risk-badge.none { background:var(--green-bg); color:var(--green); border:1px solid rgba(34,197,94,.3); }
.risk-badge .dot { width:10px; height:10px; border-radius:50%; background:currentColor; }

/* Stat cards */
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:32px; }
.stat-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; }
.stat-card .label { font-size:12px; color:var(--text3); text-transform:uppercase; letter-spacing:.05em; }
.stat-card .value { font-size:28px; font-weight:700; margin-top:4px; font-family:var(--mono); }
.stat-card .value.pos { color:var(--green); }
.stat-card .value.neg { color:var(--red); }
.stat-card .value.warn { color:var(--orange); }
.stat-card .delta { font-size:12px; color:var(--text2); margin-top:2px; }

/* Section */
.section { margin-bottom:36px; }
.section-title { font-size:17px; font-weight:600; margin-bottom:16px; display:flex; align-items:center; gap:10px; }
.section-title .count { background:var(--surface2); color:var(--text2); font-size:12px; padding:2px 10px; border-radius:20px; font-weight:500; }

/* Graph */
.graph-container { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px; overflow-x:auto; }
.graph-svg { display:block; min-width:600px; }
.triple-graph { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
.graph-panel { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; overflow-x:auto; }
.graph-panel.before { border-top:3px solid var(--red); }
.graph-panel.delta { border-top:3px solid var(--purple); }
.graph-panel.after { border-top:3px solid var(--green); }
.graph-panel-title { font-size:13px; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
.graph-panel-title .tag-label { font-size:11px; padding:2px 10px; border-radius:4px; font-family:var(--mono); }
.graph-panel.before .tag-label { background:var(--red-bg); color:var(--red); }
.graph-panel.delta .tag-label { background:rgba(139,92,246,.15); color:var(--purple); }
.graph-panel.after .tag-label { background:var(--green-bg); color:var(--green); }
.graph-panel .graph-svg { min-width:280px; width:auto; max-width:none; height:auto; }
@media (max-width:1100px) { .triple-graph { grid-template-columns:1fr; } }
.graph-hint { font-size:12px; color:var(--text3); margin-bottom:12px; line-height:1.6; }
.graph-hint strong { color:var(--text2); }
.layer-band { fill:rgba(255,255,255,.02); }
.layer-label { font-family:var(--mono); font-size:11px; fill:var(--text3); text-transform:uppercase; letter-spacing:.08em; }
.file-box { fill:rgba(255,255,255,.015); stroke:var(--border); stroke-width:1; }
.file-box.added { stroke:var(--green); stroke-dasharray:6 4; fill:rgba(34,197,94,.05); }
.file-box.removed { stroke:var(--red); stroke-dasharray:6 4; fill:rgba(239,68,68,.04); }
.file-box.growth { stroke:var(--orange); stroke-width:2.5; fill:rgba(249,115,22,.06); }
.file-box.growth-med { stroke:var(--red); stroke-width:3; fill:rgba(239,68,68,.08); }
.graph-panel.delta .file-box.growth,
.graph-panel.delta .file-box.growth-med { animation: av-loc-glow 2.2s ease-in-out infinite; }
@keyframes av-loc-glow {
  0%, 100% { filter: drop-shadow(0 0 0 rgba(249,115,22,.3)); }
  50% { filter: drop-shadow(0 0 6px rgba(249,115,22,.5)); }
}
.file-header { font-family:var(--mono); font-size:10px; fill:var(--text2); font-weight:600; }
.file-badges { font-family:var(--mono); font-size:10px; font-weight:700; }
.file-badges .fb-add { fill:var(--green); }
.file-badges .fb-rem { fill:var(--red); }
.file-badges .fb-mod { fill:var(--yellow); }
.file-badges .fb-mov { fill:var(--purple); }
.file-badges .fb-loc { fill:var(--orange); font-weight:700; }
.node-rect { rx:6; stroke-width:1.5; cursor:pointer; transition:opacity .15s; }
.node-rect.added { stroke:var(--green); fill:rgba(34,197,94,.18); stroke-width:2.4; }
.node-rect.removed { stroke:var(--red); fill:rgba(239,68,68,.14); stroke-dasharray:4 3; stroke-width:2.4; }
.node-rect.modified { stroke:var(--yellow); fill:rgba(234,179,8,.18); stroke-width:2.4; }
.node-rect.moved { stroke:var(--purple); fill:rgba(139,92,246,.16); stroke-width:2.4; }
.node-rect.renamed { stroke:var(--cyan); fill:rgba(6,182,212,.14); stroke-dasharray:4 3; stroke-width:2.4; }
.node-rect.unchanged { stroke:var(--border); fill:var(--surface2); }
.node-rect.violation { stroke:var(--orange); stroke-width:2; fill:rgba(249,115,22,.06); }
@keyframes av-delta-glow {
  0%, 100% { filter: drop-shadow(0 0 0 transparent); }
  50% { filter: drop-shadow(0 0 7px currentColor); }
}
@keyframes av-violation-glow {
  0%, 100% { filter: drop-shadow(0 0 0 transparent); }
  50% { filter: drop-shadow(0 0 6px rgba(249,115,22,.75)); }
}
.graph-panel.delta .node-rect.added,
.graph-panel.delta .node-rect.removed,
.graph-panel.delta .node-rect.modified,
.graph-panel.delta .node-rect.moved,
.graph-panel.delta .node-rect.renamed {
  animation: av-delta-glow 1.8s ease-in-out infinite;
}
/* 仅违规 tab：delta 面板违规节点/边呼吸发光 + 违规边加粗，与 before/after 静态态形成区分 */
.graph-panel.delta .node-rect.violation {
  stroke-width:2.5;
  animation: av-violation-glow 1.6s ease-in-out infinite;
}
.graph-panel.delta .edge-path.violation {
  stroke-width:2.8;
  opacity:1;
  animation: av-violation-glow 1.6s ease-in-out infinite;
}
.node-badge-bg { pointer-events:none; }
.node-badge-bg.added { fill:var(--green); }
.node-badge-bg.removed { fill:var(--red); }
.node-badge-bg.modified { fill:var(--yellow); }
.node-badge-bg.moved { fill:var(--purple); }
.node-badge-bg.renamed { fill:var(--cyan); }
.node-badge {
  font-family:var(--mono); font-size:9px; font-weight:700; pointer-events:none; fill:#0b1220;
}
.node-badge.added { fill:var(--green); }
.node-badge.removed { fill:var(--red); }
.node-badge.modified { fill:var(--yellow); }
.node-badge.moved { fill:var(--purple); }
.node-badge.renamed { fill:var(--cyan); }
.node-text { font-family:var(--mono); font-size:11px; fill:var(--text); pointer-events:none; }
.node-text.added { fill:var(--green); }
.node-text.removed { fill:var(--red); text-decoration:line-through; }
.node-text.modified { fill:var(--yellow); }
.node-text.moved { fill:var(--purple); }
.node-text.renamed { fill:var(--cyan); }
.node-kind { font-family:var(--mono); font-size:9px; fill:var(--text3); pointer-events:none; }
.edge-path { fill:none; stroke-width:1.2; opacity:.4; transition:opacity .15s; }
.edge-path.added { stroke:var(--green); opacity:.7; stroke-width:1.8; }
.edge-path.removed { stroke:var(--red); opacity:.4; stroke-dasharray:5 4; }
.edge-path.rerouted { stroke:var(--purple); opacity:.75; stroke-width:1.8; stroke-dasharray:6 3; }
.edge-path.violation { stroke:var(--orange); opacity:.8; stroke-width:2; }
.edge-path.unchanged { stroke:var(--text3); opacity:.15; }
.graph-legend { display:flex; gap:20px; margin-top:14px; flex-wrap:wrap; }
.legend-item { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text2); }
.legend-swatch { width:20px; height:3px; border-radius:2px; }
.legend-swatch.node { width:14px; height:14px; border-radius:3px; border:1.5px solid; }

/* Findings */
.finding { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:14px 16px; margin-bottom:10px; display:flex; gap:14px; align-items:flex-start; }
.finding.high { border-left:3px solid var(--red); }
.finding.medium { border-left:3px solid var(--orange); }
.finding.low { border-left:3px solid var(--blue); }
.finding.info { border-left:3px solid var(--text3); }
.finding-icon { font-size:18px; flex-shrink:0; margin-top:1px; }
.finding-body { flex:1; min-width:0; }
.finding-title { font-weight:600; font-size:14px; }
.finding-msg { color:var(--text2); font-size:13px; margin-top:2px; }
.finding-detail { font-family:var(--mono); font-size:12px; color:var(--text3); margin-top:6px; word-break:break-all; }
.finding-loc { font-family:var(--mono); font-size:11px; color:var(--text3); margin-top:4px; }
.sev-tag { font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; text-transform:uppercase; flex-shrink:0; }
.sev-tag.high { background:var(--red-bg); color:var(--red); }
.sev-tag.medium { background:var(--orange-bg); color:var(--orange); }
.sev-tag.low { background:rgba(59,130,246,.12); color:var(--blue); }
.sev-tag.info { background:var(--surface2); color:var(--text3); }

/* Change lists */
.change-group { margin-bottom:20px; }
.change-group-title { font-size:13px; font-weight:600; color:var(--text2); margin-bottom:8px; display:flex; align-items:center; gap:8px; }
.change-group-title .icon { font-size:14px; }
.change-item { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:10px 14px; margin-bottom:6px; display:flex; align-items:center; gap:10px; font-size:13px; flex-wrap:wrap; }
.change-item .kind-tag { font-family:var(--mono); font-size:10px; padding:1px 7px; border-radius:4px; background:var(--surface2); color:var(--text2); text-transform:uppercase; flex-shrink:0; }
.change-item .name { font-family:var(--mono); font-weight:600; min-width:0; }
.change-item .path { color:var(--text3); font-size:12px; margin-left:auto; font-family:var(--mono); min-width:0; max-width:46%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.change-item.added .name { color:var(--green); }
.change-item.removed .name { color:var(--red); }
.change-item .layer-tag { font-size:10px; padding:1px 7px; border-radius:4px; color:#fff; flex-shrink:0; }
.change-detail { font-family:var(--mono); font-size:12px; color:var(--text2); margin-top:4px; }
.change-detail .plus { color:var(--green); }
.change-detail .minus { color:var(--red); }

/* Empty state */
.empty { text-align:center; padding:40px; color:var(--text3); font-size:14px; }
.empty .big { font-size:32px; margin-bottom:8px; }
.empty-inline { text-align:left; padding:6px 0 2px; font-size:13px; color:var(--text3); }

/* Tooltip */
.tooltip { position:fixed; background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:12px; pointer-events:none; z-index:100; max-width:320px; box-shadow:0 8px 24px rgba(0,0,0,.4); display:none; }
.tooltip .tt-name { font-family:var(--mono); font-weight:700; font-size:13px; margin-bottom:4px; }
.tooltip .tt-meta { color:var(--text2); }
.tooltip .tt-methods { color:var(--text3); font-family:var(--mono); font-size:11px; margin-top:4px; }

/* Filter bar */
.filter-bar { display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; }
.filter-btn { background:var(--surface); border:1px solid var(--border); color:var(--text2); padding:5px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-family:var(--sans); transition:all .15s; }
.filter-btn:hover { border-color:var(--text3); color:var(--text); }
.filter-btn.active { background:var(--blue); border-color:var(--blue); color:#fff; }
.filter-notice { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 14px; padding:10px 14px; border:1px solid var(--border); border-left:3px solid var(--green); border-radius:6px; background:var(--surface); color:var(--text2); font-size:13px; }
.filter-notice[hidden] { display:none; }
.filter-notice button { background:var(--blue); border:none; color:#fff; padding:5px 12px; border-radius:6px; font-size:12px; cursor:pointer; font-family:var(--sans); }
.filter-notice button:hover { opacity:.9; }
.structure-details summary { cursor:pointer; user-select:none; list-style:none; }
.structure-details summary::-webkit-details-marker { display:none; }
.structure-details summary::before { content:'▸'; color:var(--text3); display:inline-block; width:1.2em; transition:transform .15s; }
.structure-details[open] summary::before { transform:rotate(90deg); }
.structure-body { margin-top:10px; }
.st-tree { font-family:var(--mono,monospace); font-size:12.5px; line-height:1.9; border:1px solid var(--border); border-radius:8px; padding:10px 12px; background:rgba(255,255,255,.015); overflow-x:auto; }
.st-row { display:flex; align-items:baseline; gap:6px; white-space:nowrap; }
.st-dir { color:var(--text2); font-weight:600; }
.st-dir-name::before { content:'📁 '; }
.st-file { color:var(--text2); }
.st-file-name { flex:0 0 auto; }
.st-file-name::before { content:'📄 '; opacity:.7; }
.st-status-dot { flex:0 0 auto; width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:2px; }
.st-row.st-added .st-file-name { color:var(--green); font-weight:600; }
.st-row.st-added .st-status-dot { background:var(--green); }
.st-row.st-removed { opacity:.8; }
.st-row.st-removed .st-file-name { color:var(--red); text-decoration:line-through; }
.st-row.st-removed .st-status-dot { background:var(--red); }
.st-row.st-modified .st-file-name { color:var(--yellow); }
.st-row.st-modified .st-status-dot { background:var(--yellow); }
.st-row.st-unchanged .st-status-dot { visibility:hidden; }
.st-meta { flex:0 0 auto; margin-left:auto; padding-left:16px; color:var(--text3); font-size:11.5px; display:flex; gap:6px; align-items:baseline; }
.st-layer { padding:0 6px; border-radius:4px; font-size:10.5px; border:1px solid var(--border); color:var(--text2); background:var(--surface); }
.st-delta { color:var(--yellow); font-weight:600; }
.st-deps { margin-top:12px; }
.st-deps-title { font-size:12.5px; color:var(--text3); margin-bottom:6px; }
.st-dep { display:inline-block; padding:2px 10px; margin:0 6px 6px 0; border-radius:999px; border:1px solid var(--border); background:var(--surface); font-size:12px; color:var(--text2); font-family:var(--mono,monospace); }
.st-dep.builtin { opacity:.65; }
.st-dep.builtin::after { content:' 内置'; font-size:10px; color:var(--text3); font-family:var(--sans); }
.st-dep.st-added { border-color:var(--green); color:var(--green); }
.st-dep.st-added::before { content:'+ '; font-weight:700; }
.st-dep.st-removed { border-color:var(--red); color:var(--red); text-decoration:line-through; }
.st-note { margin-top:8px; font-size:12px; color:var(--text3); }
`;
}

function getAppScript() {
  return `
const D = REPORT_DATA;
const app = document.getElementById('app');

// ---- Header ----
const riskLevel = D.risk.level;
const riskLabels = { high:'高风险', medium:'中风险', low:'低风险', none:'无风险' };
app.innerHTML = \`
<div class="header">
  <div>
    <h1>架构变更报告</h1>
    <div class="sub">
      \${D.repo} ·
      <code>\${D.baseFingerprint.slice(0,8)}</code> → <code>\${D.headFingerprint.slice(0,8)}</code>
      · \${new Date(D.generatedAt).toLocaleString('zh-CN')}
    </div>
  </div>
  <div class="risk-badge \${riskLevel}">
    <span class="dot"></span>
    \${riskLabels[riskLevel] || riskLevel}
  </div>
</div>

<div class="stats" id="stats"></div>

<div class="section">
  <div class="section-title">Before / Delta / After 架构对比 <span class="count" id="graph-count"></span></div>
  <div class="graph-hint">每个方框是一个<strong>文件</strong>，框内是组件。左 Before、中 <strong>Delta（只画变化，带颜色高亮）</strong>、右 After。<strong style="color:var(--green)">绿=新增</strong> · <strong style="color:var(--yellow)">黄=修改</strong> · <strong style="color:var(--red)">红=删除</strong> · <strong style="color:var(--purple)">紫=移动</strong> · <strong style="color:var(--cyan)">青=重命名</strong>。点节点看路径；默认「仅变更」会把没改的文件折起来。</div>
  <div class="filter-bar">
    <button class="filter-btn" data-filter="all">全部</button>
    <button class="filter-btn active" data-filter="changed">仅变更（默认）</button>
    <button class="filter-btn" data-filter="violations">仅违规</button>
  </div>
  <div class="filter-notice" id="filter-notice" hidden></div>
  <div class="triple-graph">
    <div class="graph-panel before">
      <div class="graph-panel-title"><span class="tag-label">BEFORE</span> 改之前（基线）</div>
      <svg class="graph-svg" id="graph-before"></svg>
    </div>
    <div class="graph-panel delta">
      <div class="graph-panel-title"><span class="tag-label">DELTA</span> 变化视图 <span class="count" id="delta-count"></span></div>
      <svg class="graph-svg" id="graph-delta"></svg>
    </div>
    <div class="graph-panel after">
      <div class="graph-panel-title"><span class="tag-label">AFTER</span> 改之后（当前）</div>
      <svg class="graph-svg" id="graph-after"></svg>
    </div>
  </div>
  <div class="graph-legend" style="margin-top:12px;">
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--border);background:rgba(255,255,255,.02);border-style:solid"></span> 文件</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--green);background:rgba(34,197,94,.15)"></span> 新增</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--red);background:rgba(239,68,68,.1)"></span> 删除</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--yellow);background:rgba(234,179,8,.12)"></span> 修改</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--purple);background:rgba(139,92,246,.12)"></span> 移动</div>
    <div class="legend-item"><span class="legend-swatch" style="background:var(--purple)"></span> 重连边</div>
    <div class="legend-item"><span class="legend-swatch" style="background:var(--orange)"></span> 违规边</div>
  </div>
</div>

<div class="section">
  <details id="structure-details" class="structure-details">
    <summary class="section-title">📁 项目结构（当前全貌） <span class="count" id="structure-count"></span></summary>
    <div class="graph-hint">仓库当前的<strong>文件树与外部依赖全貌</strong>。<strong style="color:var(--green)">绿=本轮新增</strong> · <strong style="color:var(--yellow)">黄=本轮改动</strong> · <strong style="color:var(--red)">红=删除</strong>；行尾标注行数与所属层。</div>
    <div id="structure-body"></div>
  </details>
</div>

<div class="section" id="findings-section"></div>
<div class="section" id="impact-section"></div>
<div class="section" id="entities-section"></div>
<div class="section" id="edges-section"></div>
<div class="section" id="ext-section"></div>
\`;

// ---- Stats ----
const s = D.summary;
const stats = [
  { label:'新增类型', value:s.addedTypes, cls:'pos' },
  { label:'删除类型', value:s.removedTypes, cls:'neg' },
  { label:'修改类型', value:s.modifiedNodes, cls:'warn' },
  { label:'移动', value:s.movedNodes || 0, cls:(s.movedNodes || 0) ? 'warn' : '' },
  { label:'新增关系', value:s.addedEdges, cls:'pos' },
  { label:'删除关系', value:s.removedEdges, cls:'neg' },
  { label:'重连', value:s.reroutedEdges || 0, cls:(s.reroutedEdges || 0) ? 'warn' : '' },
  { label:'分层违规', value:s.violations, cls:s.violations ? 'neg' : '' },
  { label:'外部依赖', value:'+'+s.addedExternalDeps+' -'+s.removedExternalDeps, cls:'' },
  { label:'风险项', value:D.risk.findings.length, cls:riskLevel==='high'?'neg':riskLevel==='medium'?'warn':'' }
];
document.getElementById('stats').innerHTML = stats.map(st => \`
  <div class="stat-card">
    <div class="label">\${st.label}</div>
    <div class="value \${st.cls}">\${st.value}</div>
  </div>
\`).join('');

// ---- Graph rendering (Before / Delta / After, grouped by file) ----
const svgBefore = document.getElementById('graph-before');
const svgDelta = document.getElementById('graph-delta');
const svgAfter = document.getElementById('graph-after');
const NODE_W = 148, NODE_H = 32, NODE_GAP_X = 10, NODE_GAP_Y = 10;
const LAYER_LABEL_W = 70;
const CONTENT_X = LAYER_LABEL_W + 14;
const FILE_PAD = 10, FILE_HEADER_H = 36, FILE_GAP_Y = 12, LAYER_GAP_Y = 18;
const MIN_FILE_W = 268;
const MAX_COLS = 6;

let currentFilter = 'changed';

// Decide which entities/edges are visible for the active filter.
// Key behavior: in "changed" mode we expand to the WHOLE FILE that contains a
// changed entity, so the Before panel still shows the file's existing members
// (instead of rendering blank on a pure-addition change).
function computeVisible() {
  const all = D.entities;
  if (currentFilter === 'all') return { entities: all, edges: D.edges };
  if (currentFilter === 'violations') {
    const ids = new Set();
    D.edges.forEach(e => { if (e.violation) { ids.add(e.from); ids.add(e.to); } });
    return { entities: all.filter(e => ids.has(e.id)), edges: D.edges.filter(e => e.violation) };
  }
  // changed
  const changedIds = new Set(all.filter(e => e.status !== 'unchanged').map(e => e.id));
  D.edges.forEach(e => { if (e.status !== 'unchanged' || e.violation) { changedIds.add(e.from); changedIds.add(e.to); } });
  const affectedFiles = new Set();
  all.forEach(e => { if (changedIds.has(e.id) && e.path) affectedFiles.add(e.path); });
  const entities = all.filter(e => (e.path && affectedFiles.has(e.path)) || changedIds.has(e.id));
  const entIds = new Set(entities.map(e => e.id));
  const edges = D.edges.filter(e => entIds.has(e.from) && entIds.has(e.to) && (e.status !== 'unchanged' || e.violation));
  return { entities, edges };
}

/** Delta panel: only entities/edges that actually changed (no unchanged siblings).
 *  In "violations" mode we further restrict to violation edges + their endpoints,
 *  so the delta view matches the before/after scope instead of always showing
 *  every changed entity in the repo. */
function computeDeltaVisible() {
  if (currentFilter === 'violations') {
    const ids = new Set();
    D.edges.forEach(e => { if (e.violation) { ids.add(e.from); ids.add(e.to); } });
    const entities = D.entities.filter(e => ids.has(e.id));
    const edges = D.edges.filter(e => e.violation);
    return { entities, edges };
  }
  const entities = D.entities.filter(e => e.status !== 'unchanged');
  const entIds = new Set(entities.map(e => e.id));
  // Include endpoints of changed edges even if entity status is unchanged (e.g. reroute)
  D.edges.forEach(e => {
    if (e.status !== 'unchanged' || e.violation) { entIds.add(e.from); entIds.add(e.to); }
  });
  const withEndpoints = D.entities.filter(e => entIds.has(e.id));
  const edges = D.edges.filter(e => entIds.has(e.from) && entIds.has(e.to) && (e.status !== 'unchanged' || e.violation));
  return { entities: withEndpoints, edges };
}

function groupByLayerFile(entities) {
  const layerOrder = [...D.layers, '未分类'];
  const byLayer = new Map();
  for (const e of entities) {
    const l = e.layer || '未分类';
    if (!byLayer.has(l)) byLayer.set(l, new Map());
    const key = e.path || '(unknown)';
    const fm = byLayer.get(l);
    if (!fm.has(key)) fm.set(key, []);
    fm.get(key).push(e);
  }
  const layers = [];
  for (const layer of layerOrder) {
    if (!byLayer.has(layer)) continue;
    const files = [];
    for (const [p, members] of byLayer.get(layer)) {
      members.sort((a, b) => a.name.localeCompare(b.name));
      files.push({ path: p, members });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    layers.push({ layer, files });
  }
  return layers;
}

function filePresence(members) {
  return {
    inBefore: members.some(m => m.status !== 'added'),
    inAfter: members.some(m => m.status !== 'removed'),
    inDelta: members.some(m => m.status !== 'unchanged'),
    added: members.filter(m => m.status === 'added').length,
    removed: members.filter(m => m.status === 'removed').length,
    modified: members.filter(m => m.status === 'modified' || m.status === 'renamed').length,
    moved: members.filter(m => m.status === 'moved').length
  };
}

function shortPath(p, maxChars) {
  if (!p) return '(unknown)';
  const n = maxChars || 36;
  return p.length > n ? '…' + p.slice(-(n - 1)) : p;
}

function buildLayout(entities, fileLocMap, opts) {
  const compact = !!(opts && opts.compact);
  const grouped = groupByLayerFile(entities);
  let maxMembers = 1;
  for (const l of grouped) for (const f of l.files) maxMembers = Math.max(maxMembers, f.members.length);
  const nCols = Math.max(1, Math.min(MAX_COLS, maxMembers));
  const innerW = nCols * NODE_W + (nCols - 1) * NODE_GAP_X;
  // Compact mode (delta panel): no forced minimum width — let node content
  // drive the box width so small changes don't leave a wide empty box.
  const minFileW = compact ? 0 : MIN_FILE_W;
  const containerW = Math.max(minFileW, innerW + FILE_PAD * 2);
  const totalWidth = CONTENT_X + containerW + 16;

  const nodePos = new Map();
  const layerBands = [];
  const fileBoxes = [];
  let y = LAYER_GAP_Y;

  for (const layerGroup of grouped) {
    const layerStartY = y;
    for (const file of layerGroup.files) {
      const rows = Math.max(1, Math.ceil(file.members.length / nCols));
      const containerH = FILE_HEADER_H + FILE_PAD + rows * NODE_H + (rows - 1) * NODE_GAP_Y + FILE_PAD;
      const box = { path: file.path, x: CONTENT_X, y, w: containerW, h: containerH, presence: filePresence(file.members), locInfo: fileLocMap && fileLocMap[file.path], members: [] };
      file.members.forEach((node, i) => {
        const r = Math.floor(i / nCols), c = i % nCols;
        const nx = CONTENT_X + FILE_PAD + c * (NODE_W + NODE_GAP_X);
        const ny = y + FILE_HEADER_H + FILE_PAD + r * (NODE_H + NODE_GAP_Y);
        const pos = { x: nx, y: ny, w: NODE_W, h: NODE_H, node };
        nodePos.set(node.id, pos);
        box.members.push(pos);
      });
      fileBoxes.push(box);
      y += containerH + FILE_GAP_Y;
    }
    layerBands.push({ layer: layerGroup.layer, y: layerStartY, h: (y - FILE_GAP_Y) - layerStartY });
    y += LAYER_GAP_Y;
  }
  // Compact mode: crop the trailing layer gap so the delta SVG hugs content.
  const viewH = compact && fileBoxes.length
    ? fileBoxes[fileBoxes.length - 1].y + fileBoxes[fileBoxes.length - 1].h + FILE_GAP_Y
    : y;
  return { nodePos, layerBands, fileBoxes, totalWidth, totalHeight: y, viewH, fileCount: fileBoxes.length };
}

/** 标题旁计数：变更口径 vs 图上可见实体口径分开写，避免「卡片 1、图 4」被当成抽丢。 */
function formatGraphCount(visibleEntities, visibleEdges) {
  if (currentFilter === 'violations') {
    return visibleEdges.length
      ? '违规 ' + visibleEdges.length + ' 条 · 图上 ' + visibleEntities.length + ' 个实体'
      : '无违规';
  }
  if (currentFilter === 'all') {
    return '全部 ' + visibleEntities.length + ' 个实体 · ' + visibleEdges.length + ' 条关系';
  }
  const changedEnt = D.entities.filter(e => e.status !== 'unchanged').length;
  const parts = [changedEnt + ' 个变更'];
  if (visibleEntities.length > changedEnt) {
    // 「仅变更」会展开含变更实体的整文件，Before 栏才不空
    parts.push('图上含同文件 ' + visibleEntities.length + ' 个');
  } else {
    parts.push('图上 ' + visibleEntities.length + ' 个');
  }
  parts.push(visibleEdges.length + ' 条关系');
  return parts.join(' · ');
}

function renderGraph() {
  const { entities: visibleEntities, edges: visibleEdges } = computeVisible();
  const deltaVis = computeDeltaVisible();
  document.getElementById('graph-count').textContent =
    formatGraphCount(visibleEntities, visibleEdges);
  const dc = document.getElementById('delta-count');
  if (dc) {
    if (currentFilter === 'violations') {
      // 违规模式下 delta 面板展示的是违规边及端点，变更状态统计无意义
      dc.textContent = deltaVis.edges.length
        ? '违规 ' + deltaVis.edges.length + ' 条 · 涉及 ' + deltaVis.entities.length + ' 个实体'
        : '无违规';
    } else {
      const n = { added: 0, removed: 0, modified: 0, moved: 0, renamed: 0 };
      deltaVis.entities.forEach((e) => { if (n[e.status] != null) n[e.status]++; });
      const bits = [];
      if (n.added) bits.push('+' + n.added);
      if (n.removed) bits.push('−' + n.removed);
      if (n.modified) bits.push('~' + n.modified);
      if (n.moved) bits.push('↔' + n.moved);
      if (n.renamed) bits.push('→' + n.renamed);
      dc.textContent = bits.length ? bits.join(' ') : '无结构变化';
    }
  }

  // 「仅违规」下没有违规边、但本轮确有变更时，三栏会是全空白板，
  // 给一个显眼的一键入口，避免被误读成“报告坏了 / 啥也没检测到”。
  const noticeEl = document.getElementById('filter-notice');
  if (noticeEl) {
    const changedCount = D.entities.filter(e => e.status !== 'unchanged').length;
    const show = currentFilter === 'violations' && deltaVis.edges.length === 0 && changedCount > 0;
    noticeEl.hidden = !show;
    if (show) {
      noticeEl.innerHTML = '✅ 本轮没有跨层违规边；下面三栏在「仅违规」视图下为空。本轮共有 <strong>' +
        changedCount + '</strong> 个实体变更——' +
        '<button type="button" id="filter-notice-btn">查看本轮变更（仅变更）</button>';
      const btn = document.getElementById('filter-notice-btn');
      if (btn) btn.onclick = () => document.querySelector('.filter-btn[data-filter="changed"]').click();
    }
  }

  const layout = buildLayout(visibleEntities, D.fileLocMap);
  const deltaLayout = buildLayout(deltaVis.entities.length ? deltaVis.entities : [], D.fileLocMap, { compact: true });

  // Shared tooltip
  let tooltip = document.querySelector('.tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    document.body.appendChild(tooltip);
  }

  // Render one side. Before = baseline (no 'added'), After = current (no 'removed'),
  // Delta = only changed statuses.
  function renderSide(svgEl, side, lay, edges) {
    const isBefore = side === 'before';
    const isDelta = side === 'delta';
    // delta 布局的实体/边已由 computeDeltaVisible 预筛（变更实体 + 变更/违规边
    // 端点），这里全部放行；否则 unchanged 端点会被"只画变更"谓词过滤掉，
    // 连向它们的新增/违规边也跟着丢失（仅违规 tab 空白、新 import 边断连）。
    const isViolMode = currentFilter === 'violations';
    const memberPred = isDelta
      ? () => true
      : isBefore ? (e) => e.status !== 'added' : (e) => e.status !== 'removed';
    const edgePred = isDelta
      ? (e) => e.status !== 'unchanged' || e.violation
      : isBefore ? (e) => e.status !== 'added' : (e) => e.status !== 'removed';

    const empty = !lay.fileBoxes.length;
    const tw = empty ? 280 : lay.totalWidth;
    const th = empty ? 80 : (lay.viewH || lay.totalHeight);
    svgEl.setAttribute('viewBox', \`0 0 \${tw} \${th}\`);
    svgEl.setAttribute('width', tw);
    svgEl.setAttribute('height', th);

    let html = '';
    if (empty && isDelta) {
      html = \`<text class="layer-label" x="16" y="40">\${isViolMode ? '无违规' : '无结构变化'}</text>\`;
      svgEl.innerHTML = html;
      return;
    }

    for (const lb of lay.layerBands) {
      const color = layerColor(lb.layer);
      html += \`<rect class="layer-band" x="0" y="\${lb.y}" width="\${lay.totalWidth}" height="\${lb.h}" rx="10"/>\`;
      html += \`<text class="layer-label" x="8" y="\${lb.y + lb.h/2 + 4}">\${layerLabelCn(lb.layer)}</text>\`;
      html += \`<line x1="\${LAYER_LABEL_W}" y1="\${lb.y + 6}" x2="\${LAYER_LABEL_W}" y2="\${lb.y + lb.h - 6}" stroke="\${color}" stroke-width="2" opacity=".25" stroke-linecap="round"/>\`;
    }

    for (const box of lay.fileBoxes) {
      const show = isDelta ? true : (isBefore ? box.presence.inBefore : box.presence.inAfter);
      if (!show) continue;
      let boxCls = !box.presence.inBefore ? 'file-box added' : !box.presence.inAfter ? 'file-box removed' : 'file-box';
      if (isDelta && box.locInfo && box.locInfo.severity) boxCls += ' ' + box.locInfo.severity;
      html += \`<rect class="\${boxCls}" x="\${box.x}" y="\${box.y}" width="\${box.w}" height="\${box.h}" rx="8"/>\`;
      const pathChars = Math.max(16, Math.floor((box.w - FILE_PAD * 2) / 6.2));
      html += \`<text class="file-header" x="\${box.x + FILE_PAD}" y="\${box.y + 13}">\${shortPath(box.path, pathChars)}</text>\`;
      const badges = [];
      if ((isBefore || isDelta) && box.presence.removed) badges.push(\`<tspan class="fb-rem">-\${box.presence.removed}</tspan>\`);
      if ((!isBefore || isDelta) && box.presence.added) badges.push(\`<tspan class="fb-add">+\${box.presence.added}</tspan>\`);
      if ((!isBefore || isDelta) && box.presence.modified) badges.push(\`<tspan class="fb-mod">~\${box.presence.modified}</tspan>\`);
      if ((!isBefore || isDelta) && box.presence.moved) badges.push(\`<tspan class="fb-mov">↔\${box.presence.moved}</tspan>\`);
      if (isDelta && box.locInfo && box.locInfo.label) {
        badges.push(\`<tspan class="fb-loc">\${box.locInfo.label}</tspan>\`);
      }
      if (badges.length) {
        html += \`<text class="file-badges" x="\${box.x + FILE_PAD}" y="\${box.y + 26}">\${badges.join('  ')}</text>\`;
      }
    }

    const pos = (id) => lay.nodePos.get(id);
    for (const edge of edges) {
      if (!edgePred(edge)) continue;
      const fp = pos(edge.from), tp = pos(edge.to);
      if (!fp || !tp) continue;
      if (!memberPred(fp.node) || !memberPred(tp.node)) continue;
      const x1 = fp.x + fp.w/2, y1 = fp.y + fp.h;
      const x2 = tp.x + tp.w/2, y2 = tp.y;
      const midY = (y1 + y2) / 2;
      const cls = edge.violation ? 'violation' : edge.status;
      const d = \`M\${x1},\${y1} C\${x1},\${midY} \${x2},\${midY} \${x2},\${y2}\`;
      html += \`<path class="edge-path \${cls}" d="\${d}" data-edge="\${edge.from}|\${edge.type}|\${edge.to}"/>\`;
    }

    for (const box of lay.fileBoxes) {
      const show = isDelta ? true : (isBefore ? box.presence.inBefore : box.presence.inAfter);
      if (!show) continue;
      for (const p of box.members) {
        const node = p.node;
        if (!memberPred(node)) continue;
        const hasViolation = edges.some(e => e.violation && (e.from === node.id || e.to === node.id) && edgePred(e));
        let cls = node.status;
        if (hasViolation) cls = 'violation';
        const mark = node.status === 'added' ? '+' : node.status === 'removed' ? '−' : node.status === 'modified' ? '~' : node.status === 'moved' ? '↔' : node.status === 'renamed' ? '→' : '';
        const clipId = 'nc-' + String(node.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const nameW = mark ? p.w - 22 : p.w - 12;
        const badge = mark
          ? \`<circle class="node-badge-bg \${node.status}" cx="\${p.x + p.w - 10}" cy="\${p.y + 10}" r="6"/>
          <text class="node-badge" x="\${p.x + p.w - 10}" y="\${p.y + 13}" text-anchor="middle">\${mark}</text>\`
          : '';
        html += \`<g class="node-group" data-id="\${node.id}">
          <defs><clipPath id="\${clipId}"><rect x="\${p.x + 5}" y="\${p.y + 13}" width="\${nameW}" height="16"/></clipPath></defs>
          <rect class="node-rect \${cls}" x="\${p.x}" y="\${p.y}" width="\${p.w}" height="\${p.h}"/>
          <text class="node-kind" x="\${p.x + 6}" y="\${p.y + 11}">\${node.kind}</text>
          <text class="node-text \${node.status}" x="\${p.x + 6}" y="\${p.y + 24}" clip-path="url(#\${clipId})">\${truncate(node.name, 20)}</text>
          \${badge}
        </g>\`;
      }
    }

    svgEl.innerHTML = html;

    svgEl.querySelectorAll('.node-group').forEach(g => {
      g.addEventListener('mouseenter', () => {
        const id = g.dataset.id;
        const node = D.entities.find(e => e.id === id);
        if (!node) return;
        tooltip.innerHTML = \`<div class="tt-name">\${node.name}</div>
          <div class="tt-meta">\${node.kind} · \${layerLabelCn(node.layer)} · \${node.lang} · \${node.status}</div>
          <div class="tt-meta">\${node.path || ''}</div>
          \${node.methods.length ? '<div class="tt-methods">'+node.methods.slice(0,8).join(', ')+(node.methods.length>8?'…':'')+'</div>' : ''}\`;
        tooltip.style.display = 'block';
        svgEl.querySelectorAll('.edge-path').forEach(p => {
          const parts = (p.dataset.edge || '').split('|');
          p.style.opacity = (parts[0] === id || parts[2] === id) ? '1' : '';
        });
      });
      g.addEventListener('mousemove', (ev) => {
        tooltip.style.left = (ev.clientX + 14) + 'px';
        tooltip.style.top = (ev.clientY + 14) + 'px';
      });
      g.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        svgEl.querySelectorAll('.edge-path').forEach(p => { p.style.opacity = ''; });
      });
    });
  }

  renderSide(svgBefore, 'before', layout, visibleEdges);
  renderSide(svgDelta, 'delta', deltaLayout, deltaVis.edges);
  renderSide(svgAfter, 'after', layout, visibleEdges);
}

function layerColor(l) {
  const colors = { component:'#8b5cf6', controller:'#3b82f6', service:'#10b981', domain:'#f59e0b', storage:'#ef4444', dto:'#6b7280', config:'#ec4899', util:'#64748b', '未分类':'#94a3b8' };
  return colors[l] || '#94a3b8';
}
function layerLabelCn(l) {
  const labels = { component:'组件', controller:'控制器', service:'服务', domain:'领域', storage:'存储', dto:'DTO', config:'配置', util:'工具', '未分类':'未分类' };
  return labels[l] || l;
}
function truncate(s, n) { return s.length > n ? s.slice(0, n-1) + '…' : s; }

// ---- 项目结构（文件树 + 外部依赖全貌）----
function escText(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function renderStructure() {
  const st = D.structure;
  const sec = document.getElementById('structure-body');
  const details = document.getElementById('structure-details');
  const countEl = document.getElementById('structure-count');
  if (!st || !st.files.length) {
    if (details) details.parentElement.style.display = 'none';
    return;
  }
  const addN = st.files.filter(f => f.status === 'added').length;
  const modN = st.files.filter(f => f.status === 'modified').length;
  const remN = st.files.filter(f => f.status === 'removed').length;
  const present = st.files.length - remN;

  // 由文件路径构建目录树
  const root = { dirs: new Map(), files: [] };
  const dirSet = new Set();
  for (const f of st.files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dirSet.add(parts.slice(0, i + 1).join('/'));
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(f);
  }

  const rows = [];
  function walk(node, depth) {
    const pad = 'padding-left:' + (depth * 16 + 4) + 'px';
    for (const d of [...node.dirs.keys()].sort()) {
      rows.push('<div class="st-row st-dir" style="' + pad + '"><span class="st-dir-name">' + escText(d) + '/</span></div>');
      walk(node.dirs.get(d), depth + 1);
    }
    for (const f of node.files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
      const name = f.path.split('/').pop();
      const meta = [];
      if (f.lines) meta.push(f.lines + ' 行');
      if (f.layer) meta.push('<span class="st-layer">' + escText(layerLabelCn(f.layer)) + '</span>');
      if (f.status === 'modified' && f.delta !== 0) meta.push('<span class="st-delta">' + (f.delta > 0 ? '+' : '') + f.delta + ' 行</span>');
      rows.push('<div class="st-row st-' + f.status + '" style="' + pad + '">'
        + '<span class="st-status-dot"></span>'
        + '<span class="st-file-name">' + escText(name) + '</span>'
        + (meta.length ? '<span class="st-meta">' + meta.join('') + '</span>' : '')
        + '</div>');
    }
  }
  walk(root, 0);

  const depAlive = st.deps.filter(d => d.status !== 'removed').length;
  let depsHtml = '';
  if (st.deps.length) {
    depsHtml = '<div class="st-deps"><div class="st-deps-title">外部依赖（' + depAlive + '）</div>'
      + st.deps.map(d => '<span class="st-dep st-' + d.status + (d.builtin ? ' builtin' : '') + '">' + escText(d.name) + '</span>').join('')
      + '</div>';
  }
  const noteHtml = st.truncated
    ? '<div class="st-note">文件较多，仅展示前 ' + st.files.length + ' 个（本轮变更文件优先）；共 ' + st.totalFiles + ' 个。</div>'
    : '';

  sec.innerHTML = '<div class="st-tree">' + rows.join('') + '</div>' + depsHtml + noteHtml;

  const bits = [];
  if (addN) bits.push('+' + addN);
  if (remN) bits.push('-' + remN);
  if (modN) bits.push('~' + modN);
  countEl.textContent = present + ' 文件 · ' + dirSet.size + ' 目录 · ' + depAlive + ' 依赖'
    + (bits.length ? '（本轮 ' + bits.join(' ') + '）' : '');

  // 小仓库默认展开；大仓库折叠，避免几百行文件刷屏
  if (present <= 60) details.open = true;
}
renderStructure();

renderGraph();

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderGraph();
  });
});

// ---- Findings ----
const findingsSection = document.getElementById('findings-section');
if (D.risk.findings.length > 0) {
  const icons = { high:'🔴', medium:'🟠', low:'🔵', info:'⚪' };
  findingsSection.innerHTML = \`
    <div class="section-title">风险发现 <span class="count">\${D.risk.findings.length}</span></div>
    \${D.risk.findings.map(f => \`
      <div class="finding \${f.severity}">
        <div class="finding-icon">\${icons[f.severity] || '⚪'}</div>
        <div class="finding-body">
          <div class="finding-title">\${f.title}</div>
          <div class="finding-msg">\${f.message}</div>
          \${f.detail ? '<div class="finding-detail">'+f.detail+'</div>' : ''}
          \${f.file ? '<div class="finding-loc">'+f.file+(f.line?':'+f.line:'')+'</div>' : ''}
        </div>
        <span class="sev-tag \${f.severity}">\${f.severity}</span>
      </div>
    \`).join('')}
  \`;
}

// ---- Impact（反向依赖影响面）----
const impactSection = document.getElementById('impact-section');
if (D.impact && D.impact.items.length) {
  impactSection.innerHTML = \`
    <div class="section-title">影响面 <span class="count">被改 \${D.impact.changedCount} · 波及下游 \${D.impact.impactedCount}</span></div>
    \${D.impact.items.map(it => \`
      <div class="finding low">
        <div class="finding-icon">🔗</div>
        <div class="finding-body">
          <div class="finding-title">[\${it.label}] \${it.name}
            <span class="sev-tag low">直接 \${it.directCount} · 间接 \${it.transitiveCount}</span>
          </div>
          \${it.direct.length ? '<div class="finding-msg">直接下游：' + it.direct.map(d => d.name).join('、') + (it.directCount > it.direct.length ? ' 等' : '') + '</div>' : ''}
          \${it.path ? '<div class="finding-loc">' + it.path + '</div>' : ''}
        </div>
      </div>
    \`).join('')}
  \`;
}

// ---- Entity changes ----
const entSection = document.getElementById('entities-section');
const added = D.entities.filter(e => e.status === 'added');
const removed = D.entities.filter(e => e.status === 'removed');
const renamedList = D.renamed || [];
const movedList = D.moved || [];
let entHtml = '<div class="section-title">实体变更 <span class="count">+' + added.length + ' -' + removed.length + ' ~' + D.modified.length + (movedList.length ? ' ↔' + movedList.length : '') + (renamedList.length ? ' ↻' + renamedList.length : '') + '</span></div>';

if (added.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🟢</span> 新增实体</div>';
  entHtml += added.map(e => changeItem(e, 'added')).join('');
  entHtml += '</div>';
}
const movePairs = renamedList.filter(r => r.moved);
const renamePairs = renamedList.filter(r => !r.moved);
if (movePairs.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🟣</span> 移动（跨目录，实体随文件迁移）</div>';
  entHtml += movePairs.map(r => \`
    <div class="change-item">
      <span class="kind-tag">\${r.kind}</span>
      <span class="name" style="color:var(--purple)">\${r.newName}</span>
      <span class="path">\${r.fromPath} → \${r.toPath}</span>
    </div>
  \`).join('');
  entHtml += '</div>';
}
if (renamePairs.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🔄</span> 重命名</div>';
  entHtml += renamePairs.map(r => \`
    <div class="change-item">
      <span class="kind-tag">\${r.kind}</span>
      <span class="name" style="color:var(--red);text-decoration:line-through">\${r.oldName}</span>
      <span style="color:var(--text3)">→</span>
      <span class="name" style="color:var(--cyan)">\${r.newName}</span>
      <span class="path">\${r.path || ''}</span>
    </div>
  \`).join('');
  entHtml += '</div>';
}
if (removed.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🔴</span> 删除实体</div>';
  entHtml += removed.map(e => changeItem(e, 'removed')).join('');
  entHtml += '</div>';
}
if (movedList.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🟣</span> 移动（路径/分层）</div>';
  for (const m of movedList) {
    entHtml += \`<div class="change-item" style="flex-wrap:wrap">
      <span class="kind-tag">\${m.kind}</span>
      <span class="name" style="color:var(--purple)">\${m.name}</span>
      <div style="width:100%">
        \${m.changes.map(c => '<div class="change-detail">'+c.field+': '+c.from+' → '+c.to+'</div>').join('')}
      </div>
    </div>\`;
  }
  entHtml += '</div>';
}
if (D.modified.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🟡</span> 修改实体</div>';
  for (const m of D.modified) {
    entHtml += \`<div class="change-item" style="flex-wrap:wrap">
      <span class="kind-tag">\${m.kind}</span>
      <span class="name">\${m.name}</span>
      <span class="layer-tag" style="background:\${layerColor(m.layer)}">\${layerLabelCn(m.layer)}</span>
      <div style="width:100%">
        \${m.changes.map(c => {
          if (c.field === 'methods') {
            let h = '';
            if (c.added && c.added.length) h += '<div class="change-detail"><span class="plus">+ 方法: ' + c.added.join(', ') + '</span></div>';
            if (c.removed && c.removed.length) h += '<div class="change-detail"><span class="minus">- 方法: ' + c.removed.join(', ') + '</span></div>';
            return h;
          }
          if (c.field === 'childEntities') {
            const short = (id) => String(id).split(/[#\\/]/).pop();
            let h = '';
            if (c.added && c.added.length) h += '<div class="change-detail"><span class="plus">+ 新增 ' + c.added.length + ' 个子实体: ' + c.added.slice(0,5).map(short).join(', ') + (c.added.length > 5 ? ' …' : '') + '</span></div>';
            if (c.removed && c.removed.length) h += '<div class="change-detail"><span class="minus">- 移除 ' + c.removed.length + ' 个子实体: ' + c.removed.slice(0,5).map(short).join(', ') + (c.removed.length > 5 ? ' …' : '') + '</span></div>';
            return h;
          }
          return '<div class="change-detail">'+c.field+': '+c.from+' → '+c.to+'</div>';
        }).join('')}
      </div>
    </div>\`;
  }
  entHtml += '</div>';
}
if (!added.length && !removed.length && !D.modified.length && !renamedList.length && !movedList.length) {
  entHtml += '<div class="empty"><div class="big">✓</div>无实体变更</div>';
}
entSection.innerHTML = entHtml;

function changeItem(e, status) {
  return \`<div class="change-item \${status}">
    <span class="kind-tag">\${e.kind}</span>
    <span class="name">\${e.name}</span>
    <span class="layer-tag" style="background:\${layerColor(e.layer)}">\${layerLabelCn(e.layer)}</span>
    <span class="path">\${e.path || ''}</span>
  </div>\`;
}

// ---- Edge changes ----
const edgeSection = document.getElementById('edges-section');
const edgeTypeLabels = { import:'导入', extends:'继承', implements:'实现', 'field-type':'字段类型', 'method-param':'参数类型', 'method-return':'返回类型', 'component-props':'组件Props' };
const addedEdges = D.edges.filter(e => e.status === 'added' || e.violation);
const removedEdges = D.edges.filter(e => e.status === 'removed');
const reroutedEdges = D.edges.filter(e => e.status === 'rerouted');
const entName = (id) => { const e = D.entities.find(x => x.id === id); return e ? e.name : id.split('#').pop(); };

let edgeHtml = '<div class="section-title">关系变更 <span class="count">+' + addedEdges.length + ' -' + removedEdges.length + (reroutedEdges.length ? ' ⟳' + reroutedEdges.length : '') + '</span></div>';
if (addedEdges.length) {
  edgeHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🔗</span> 新增关系</div>';
  edgeHtml += addedEdges.slice(0, 40).map(e => \`
    <div class="change-item" style="\${e.violation?'border-left:3px solid var(--orange)':''}">
      <span class="kind-tag">\${edgeTypeLabels[e.type] || e.type}</span>
      <span class="name" style="color:\${e.violation?'var(--orange)':'var(--green)'}">\${entName(e.from)}</span>
      <span style="color:var(--text3)">→</span>
      <span class="name" style="color:\${e.violation?'var(--orange)':'var(--text)'}">\${entName(e.to)}</span>
      \${e.method ? '<span class="path">.'+e.method+'()</span>' : ''}
      \${e.field ? '<span class="path">.'+e.field+'</span>' : ''}
      \${e.violation ? '<span class="sev-tag high">违规</span>' : ''}
    </div>
  \`).join('');
  if (addedEdges.length > 40) edgeHtml += '<div class="change-item" style="color:var(--text3)">… 还有 ' + (addedEdges.length - 40) + ' 条</div>';
  edgeHtml += '</div>';
}
if (reroutedEdges.length) {
  edgeHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🟣</span> 重连关系（类型变更）</div>';
  edgeHtml += reroutedEdges.slice(0, 40).map(e => \`
    <div class="change-item" style="border-left:3px solid var(--purple)">
      <span class="kind-tag">\${edgeTypeLabels[e.fromType] || e.fromType || '?'} → \${edgeTypeLabels[e.type] || e.type}</span>
      <span class="name" style="color:var(--purple)">\${entName(e.from)}</span>
      <span style="color:var(--text3)">→</span>
      <span class="name">\${entName(e.to)}</span>
    </div>
  \`).join('');
  edgeHtml += '</div>';
}
if (removedEdges.length) {
  edgeHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">✂️</span> 删除关系</div>';
  edgeHtml += removedEdges.slice(0, 20).map(e => \`
    <div class="change-item removed">
      <span class="kind-tag">\${edgeTypeLabels[e.type] || e.type}</span>
      <span class="name">\${entName(e.from)}</span>
      <span style="color:var(--text3)">→</span>
      <span class="name">\${entName(e.to)}</span>
    </div>
  \`).join('');
  edgeHtml += '</div>';
}
if (!addedEdges.length && !removedEdges.length && !reroutedEdges.length) {
  edgeHtml += '<div class="empty-inline">无关系变更</div>';
}
edgeSection.innerHTML = edgeHtml;

// ---- External deps ----
const extSection = document.getElementById('ext-section');
if (D.extAdded.length || D.extRemoved.length) {
  let extHtml = '<div class="section-title">外部依赖变更 <span class="count">+' + D.extAdded.length + ' -' + D.extRemoved.length + '</span></div>';
  if (D.extAdded.length) {
    extHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">📦</span> 新增依赖</div>';
    extHtml += D.extAdded.map(d => \`<div class="change-item added"><span class="kind-tag">\${d.builtin?'stdlib':'external'}</span><span class="name">\${d.name}</span></div>\`).join('');
    extHtml += '</div>';
  }
  if (D.extRemoved.length) {
    extHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🗑️</span> 移除依赖</div>';
    extHtml += D.extRemoved.map(d => \`<div class="change-item removed"><span class="kind-tag">\${d.builtin?'stdlib':'external'}</span><span class="name">\${d.name}</span></div>\`).join('');
    extHtml += '</div>';
  }
  extSection.innerHTML = extHtml;
}
`;
}

// ---- W14-06: local tech-debt trend log (.av/session-history.jsonl) ----
// Append-only JSONL; one line per `session report` run. Local-only
// (gitignored), never blocks the gate on write failure.

function historyPath(repo) {
  return path.join(repo, '.av', 'session-history.jsonl');
}

/**
 * Append one session-report record to the local trend log. Best-effort.
 * @param {string} repo
 * @param {{baseline: object, current: object, diff: object, riskSummary: object}} data
 * @returns {boolean} whether the record was written
 */
function appendSessionHistory(repo, { baseline, current, diff, riskSummary }) {
  try {
    fs.mkdirSync(path.join(repo, '.av'), { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      baselineFp: baseline && baseline.fingerprint,
      headFp: current && current.fingerprint,
      risk: riskSummary.level,
      findings: riskSummary.counts,
      added: diff.summary.addedNodes,
      removed: diff.summary.removedNodes,
      modified: diff.summary.modifiedNodes,
      files: (current.stats && current.stats.files) || 0
    };
    fs.appendFileSync(historyPath(repo), JSON.stringify(record) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the most recent `limit` records in chronological order.
 * Missing file → []; corrupt lines skipped.
 * @param {string} repo
 * @param {number} [limit=10] - 0/negative returns all records
 */
function readSessionHistory(repo, limit = 10) {
  try {
    const raw = fs.readFileSync(historyPath(repo), 'utf8');
    const records = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        records.push(JSON.parse(t));
      } catch {
        /* skip corrupt line */
      }
    }
    return limit > 0 ? records.slice(-limit) : records;
  } catch {
    return [];
  }
}

/**
 * Plain-text table for `session history` CLI output.
 */
function formatHistoryTable(records) {
  if (!records || !records.length) {
    return '暂无历史记录（每次 session report 后自动追加到 .av/session-history.jsonl）。';
  }
  const header = ['时间'.padEnd(17), '风险'.padEnd(8), '高/中/低/信', '增/删/改', '规模'].join('  ');
  const rows = records.map((r) => {
    const ts = String(r.ts || '').replace('T', ' ').slice(0, 16).padEnd(17);
    const f = r.findings || {};
    const risk = String(r.risk || '?').toUpperCase().padEnd(8);
    const counts = `${f.high || 0}/${f.medium || 0}/${f.low || 0}/${f.info || 0}`;
    const changes = `+${r.added || 0} -${r.removed || 0} ~${r.modified || 0}`;
    return [ts, risk, counts, changes, `${r.files || 0} 文件`].join('  ');
  });
  return [header, '-'.repeat(header.length), ...rows].join('\n');
}

/** session start 刷新基线时必须清掉的上一轮报告，避免 explain/HTML 读到过期 findings。 */
const STALE_SESSION_REPORT_FILES = [
  'session-report.json',
  'session-report.html',
  'session-report.builtin.html'
];

/**
 * 删除 .av/ 下一轮会话报告。刷新基线后旧报告不再代表「这一轮」。
 * @param {string} repo
 * @returns {string[]} 实际删掉的文件名
 */
function clearStaleSessionReports(repo) {
  const dir = path.join(repo, '.av');
  const cleared = [];
  for (const name of STALE_SESSION_REPORT_FILES) {
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        cleared.push(name);
      }
    } catch {
      // 清旧报告失败不阻断拍基线
    }
  }
  return cleared;
}

module.exports = {
  generateReport,
  buildReportData,
  formatFileLocLabel,
  fileLocSeverity,
  appendSessionHistory,
  readSessionHistory,
  formatHistoryTable,
  clearStaleSessionReports,
  STALE_SESSION_REPORT_FILES,
  assertReportContract: (...a) => require('./report-contract').assertReportContract(...a)
};
