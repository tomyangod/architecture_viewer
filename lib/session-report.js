'use strict';

/**
 * Session report generator — produces a self-contained offline HTML report
 * with Before/After layered architecture diagrams and risk findings.
 */

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

  // Violation edge keys
  const violationKeys = new Set();
  for (const v of headDiff.violations) {
    violationKeys.add(`${v.from}|${v.edgeType}|${v.to}`);
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

  // Renamed entities (paired removed+added in the text diff)
  const renamed = (headDiff.renamedNodes || []).map((r) => ({
    oldName: r.oldName,
    newName: r.newName,
    kind: r.kind,
    path: r.path
  }));

  // External dep changes
  const extAdded = headDiff.addedExternalDeps.map((d) => ({ name: d.name || d.id.replace('ext:', ''), builtin: d.builtin }));
  const extRemoved = headDiff.removedExternalDeps.map((d) => ({ name: d.name || d.id.replace('ext:', ''), builtin: d.builtin }));

  return {
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
    renamed,
    extAdded,
    extRemoved
  };
}

function renderHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!-- Generated by Trae Work -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
#app { max-width:1200px; margin:0 auto; padding:32px 24px 80px; }

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
.dual-graph { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.graph-panel { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; overflow-x:auto; }
.graph-panel.before { border-top:3px solid var(--red); }
.graph-panel.after { border-top:3px solid var(--green); }
.graph-panel-title { font-size:13px; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
.graph-panel-title .tag-label { font-size:11px; padding:2px 10px; border-radius:4px; font-family:var(--mono); }
.graph-panel.before .tag-label { background:var(--red-bg); color:var(--red); }
.graph-panel.after .tag-label { background:var(--green-bg); color:var(--green); }
.graph-panel .graph-svg { min-width:0; width:100%; }
@media (max-width:900px) { .dual-graph { grid-template-columns:1fr; } }
.graph-hint { font-size:12px; color:var(--text3); margin-bottom:12px; line-height:1.6; }
.graph-hint strong { color:var(--text2); }
.layer-band { fill:rgba(255,255,255,.02); }
.layer-label { font-family:var(--mono); font-size:11px; fill:var(--text3); text-transform:uppercase; letter-spacing:.08em; }
.file-box { fill:rgba(255,255,255,.015); stroke:var(--border); stroke-width:1; }
.file-box.added { stroke:var(--green); stroke-dasharray:6 4; fill:rgba(34,197,94,.05); }
.file-box.removed { stroke:var(--red); stroke-dasharray:6 4; fill:rgba(239,68,68,.04); }
.file-header { font-family:var(--mono); font-size:10px; fill:var(--text2); font-weight:600; }
.file-badges { font-family:var(--mono); font-size:11px; font-weight:700; }
.file-badges .fb-add { fill:var(--green); }
.file-badges .fb-rem { fill:var(--red); }
.file-badges .fb-mod { fill:var(--yellow); }
.node-rect { rx:6; stroke-width:1.5; cursor:pointer; transition:opacity .15s; }
.node-rect.added { stroke:var(--green); fill:rgba(34,197,94,.08); }
.node-rect.removed { stroke:var(--red); fill:rgba(239,68,68,.06); stroke-dasharray:4 3; }
.node-rect.modified { stroke:var(--yellow); fill:rgba(234,179,8,.08); }
.node-rect.renamed { stroke:var(--cyan); fill:rgba(6,182,212,.07); stroke-dasharray:4 3; }
.node-rect.unchanged { stroke:var(--border); fill:var(--surface2); }
.node-rect.violation { stroke:var(--orange); stroke-width:2; fill:rgba(249,115,22,.06); }
.node-text { font-family:var(--mono); font-size:11px; fill:var(--text); pointer-events:none; }
.node-text.added { fill:var(--green); }
.node-text.removed { fill:var(--red); text-decoration:line-through; }
.node-text.modified { fill:var(--yellow); }
.node-text.renamed { fill:var(--cyan); }
.node-kind { font-family:var(--mono); font-size:9px; fill:var(--text3); pointer-events:none; }
.edge-path { fill:none; stroke-width:1.2; opacity:.4; transition:opacity .15s; }
.edge-path.added { stroke:var(--green); opacity:.7; stroke-width:1.8; }
.edge-path.removed { stroke:var(--red); opacity:.4; stroke-dasharray:5 4; }
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
.change-item { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:10px 14px; margin-bottom:6px; display:flex; align-items:center; gap:12px; font-size:13px; }
.change-item .kind-tag { font-family:var(--mono); font-size:10px; padding:1px 7px; border-radius:4px; background:var(--surface2); color:var(--text2); text-transform:uppercase; flex-shrink:0; }
.change-item .name { font-family:var(--mono); font-weight:600; }
.change-item .path { color:var(--text3); font-size:12px; margin-left:auto; font-family:var(--mono); }
.change-item.added .name { color:var(--green); }
.change-item.removed .name { color:var(--red); }
.change-item .layer-tag { font-size:10px; padding:1px 7px; border-radius:4px; color:#fff; flex-shrink:0; }
.change-detail { font-family:var(--mono); font-size:12px; color:var(--text2); margin-top:4px; }
.change-detail .plus { color:var(--green); }
.change-detail .minus { color:var(--red); }

/* Empty state */
.empty { text-align:center; padding:40px; color:var(--text3); font-size:14px; }
.empty .big { font-size:32px; margin-bottom:8px; }

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
  <div class="section-title">Before / After 架构对比 <span class="count" id="graph-count"></span></div>
  <div class="graph-hint">每个方框是一个<strong>文件</strong>，框内是它包含的组件（类/函数）。左右两图布局完全一致：左图是"改之前"、右图是"改之后"，对照看就能发现多了/少了哪些组件。</div>
  <div class="filter-bar">
    <button class="filter-btn" data-filter="all">全部</button>
    <button class="filter-btn active" data-filter="changed">仅变更（默认）</button>
    <button class="filter-btn" data-filter="violations">仅违规</button>
  </div>
  <div class="dual-graph">
    <div class="graph-panel before">
      <div class="graph-panel-title"><span class="tag-label">BEFORE</span> 改之前（基线）</div>
      <svg class="graph-svg" id="graph-before"></svg>
    </div>
    <div class="graph-panel after">
      <div class="graph-panel-title"><span class="tag-label">AFTER</span> 改之后（当前）</div>
      <svg class="graph-svg" id="graph-after"></svg>
    </div>
  </div>
  <div class="graph-legend" style="margin-top:12px;">
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--border);background:rgba(255,255,255,.02);border-style:solid"></span> 文件</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--green);background:rgba(34,197,94,.15)"></span> 新增组件</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--red);background:rgba(239,68,68,.1)"></span> 删除组件</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--yellow);background:rgba(234,179,8,.12)"></span> 修改</div>
    <div class="legend-item"><span class="legend-swatch node" style="border-color:var(--border);background:var(--surface2)"></span> 未变</div>
    <div class="legend-item"><span class="legend-swatch" style="background:var(--orange)"></span> 违规边</div>
  </div>
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
  { label:'新增关系', value:s.addedEdges, cls:'pos' },
  { label:'删除关系', value:s.removedEdges, cls:'neg' },
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

// ---- Graph rendering (Before / After dual, grouped by file) ----
const svgBefore = document.getElementById('graph-before');
const svgAfter = document.getElementById('graph-after');
const NODE_W = 120, NODE_H = 30, NODE_GAP_X = 10, NODE_GAP_Y = 10;
const LAYER_LABEL_W = 70;
const CONTENT_X = LAYER_LABEL_W + 14;
const FILE_PAD = 10, FILE_HEADER_H = 20, FILE_GAP_Y = 12, LAYER_GAP_Y = 18;
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
    added: members.filter(m => m.status === 'added').length,
    removed: members.filter(m => m.status === 'removed').length,
    modified: members.filter(m => m.status === 'modified' || m.status === 'renamed').length
  };
}

function shortPath(p) {
  if (!p) return '(unknown)';
  return p.length > 32 ? '…' + p.slice(-31) : p;
}

function renderGraph() {
  const { entities: visibleEntities, edges: visibleEdges } = computeVisible();
  const grouped = groupByLayerFile(visibleEntities);
  const fileCount = grouped.reduce((n, l) => n + l.files.length, 0);
  document.getElementById('graph-count').textContent =
    visibleEntities.length + ' entities · ' + visibleEdges.length + ' edges · ' + fileCount + ' files';

  // Shared geometry so both panels line up node-for-node
  let maxMembers = 1;
  for (const l of grouped) for (const f of l.files) maxMembers = Math.max(maxMembers, f.members.length);
  const nCols = Math.max(1, Math.min(MAX_COLS, maxMembers));
  const innerW = nCols * NODE_W + (nCols - 1) * NODE_GAP_X;
  const containerW = innerW + FILE_PAD * 2;
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
      const box = { path: file.path, x: CONTENT_X, y, w: containerW, h: containerH, presence: filePresence(file.members), members: [] };
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
  const totalHeight = y;

  // Shared tooltip
  let tooltip = document.querySelector('.tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    document.body.appendChild(tooltip);
  }

  // Render one side. Before = baseline state (no 'added'), After = current (no 'removed')
  function renderSide(svgEl, side) {
    const isBefore = side === 'before';
    const memberPred = isBefore ? (e) => e.status !== 'added' : (e) => e.status !== 'removed';
    const edgePred = isBefore ? (e) => e.status !== 'added' : (e) => e.status !== 'removed';

    svgEl.setAttribute('viewBox', \`0 0 \${totalWidth} \${totalHeight}\`);
    svgEl.setAttribute('width', '100%');
    svgEl.setAttribute('height', totalHeight);

    let html = '';

    // Layer bands
    for (const lb of layerBands) {
      const color = layerColor(lb.layer);
      html += \`<rect class="layer-band" x="0" y="\${lb.y}" width="\${totalWidth}" height="\${lb.h}" rx="10"/>\`;
      html += \`<text class="layer-label" x="8" y="\${lb.y + lb.h/2 + 4}">\${layerLabelCn(lb.layer)}</text>\`;
      html += \`<line x1="\${LAYER_LABEL_W}" y1="\${lb.y + 6}" x2="\${LAYER_LABEL_W}" y2="\${lb.y + lb.h - 6}" stroke="\${color}" stroke-width="2" opacity=".25" stroke-linecap="round"/>\`;
    }

    // File containers
    for (const box of fileBoxes) {
      const show = isBefore ? box.presence.inBefore : box.presence.inAfter;
      if (!show) continue;
      const boxCls = !box.presence.inBefore ? 'file-box added' : !box.presence.inAfter ? 'file-box removed' : 'file-box';
      html += \`<rect class="\${boxCls}" x="\${box.x}" y="\${box.y}" width="\${box.w}" height="\${box.h}" rx="8"/>\`;
      html += \`<text class="file-header" x="\${box.x + FILE_PAD}" y="\${box.y + 14}">\${shortPath(box.path)}</text>\`;
      const badges = [];
      if (isBefore && box.presence.removed) badges.push(\`<tspan class="fb-rem">-\${box.presence.removed}</tspan>\`);
      if (!isBefore && box.presence.added) badges.push(\`<tspan class="fb-add">+\${box.presence.added}</tspan>\`);
      if (!isBefore && box.presence.modified) badges.push(\`<tspan class="fb-mod">~\${box.presence.modified}</tspan>\`);
      if (badges.length) {
        html += \`<text class="file-badges" x="\${box.x + box.w - FILE_PAD}" y="\${box.y + 14}" text-anchor="end">\${badges.join('   ')}</text>\`;
      }
    }

    // Edges (type relations between members, e.g. extends/implements in class-based code)
    const pos = (id) => nodePos.get(id);
    for (const edge of visibleEdges) {
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

    // Member nodes
    for (const box of fileBoxes) {
      const show = isBefore ? box.presence.inBefore : box.presence.inAfter;
      if (!show) continue;
      for (const p of box.members) {
        const node = p.node;
        if (!memberPred(node)) continue;
        const hasViolation = visibleEdges.some(e => e.violation && (e.from === node.id || e.to === node.id) && edgePred(e));
        let cls = node.status;
        if (hasViolation) cls = 'violation';
        html += \`<g class="node-group" data-id="\${node.id}">
          <rect class="node-rect \${cls}" x="\${p.x}" y="\${p.y}" width="\${p.w}" height="\${p.h}"/>
          <text class="node-kind" x="\${p.x + 6}" y="\${p.y + 11}">\${node.kind}</text>
          <text class="node-text \${node.status}" x="\${p.x + 6}" y="\${p.y + 23}">\${truncate(node.name, 17)}</text>
        </g>\`;
      }
    }

    svgEl.innerHTML = html;

    // Hover tooltip + edge highlight (both directions)
    svgEl.querySelectorAll('.node-group').forEach(g => {
      g.addEventListener('mouseenter', () => {
        const id = g.dataset.id;
        const node = D.entities.find(e => e.id === id);
        if (!node) return;
        tooltip.innerHTML = \`<div class="tt-name">\${node.name}</div>
          <div class="tt-meta">\${node.kind} · \${layerLabelCn(node.layer)} · \${node.lang}</div>
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

  renderSide(svgBefore, 'before');
  renderSide(svgAfter, 'after');
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
let entHtml = '<div class="section-title">实体变更 <span class="count">+' + added.length + ' -' + removed.length + ' ~' + D.modified.length + (renamedList.length ? ' ↻' + renamedList.length : '') + '</span></div>';

if (added.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🟢</span> 新增实体</div>';
  entHtml += added.map(e => changeItem(e, 'added')).join('');
  entHtml += '</div>';
}
if (renamedList.length) {
  entHtml += '<div class="change-group"><div class="change-group-title"><span class="icon">🔄</span> 重命名</div>';
  entHtml += renamedList.map(r => \`
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
if (!added.length && !removed.length && !D.modified.length && !renamedList.length) {
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
const entName = (id) => { const e = D.entities.find(x => x.id === id); return e ? e.name : id.split('#').pop(); };

let edgeHtml = '<div class="section-title">关系变更 <span class="count">+' + addedEdges.length + ' -' + removedEdges.length + '</span></div>';
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
if (!addedEdges.length && !removedEdges.length) {
  edgeHtml += '<div class="empty"><div class="big">✓</div>无关系变更</div>';
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

module.exports = { generateReport, buildReportData };
