'use strict';

/**
 * Universal layered architecture model for block-diagram.md.
 * Any repo → classify artifacts into semantic layers → colored Mermaid flowchart.
 * Optional override: <repo>/architecture.layers.json
 */

const fs = require('fs');
const path = require('path');

/** Fixed palette + matchers. Only non-empty layers are rendered. */
const LAYER_DEFS = [
  {
    id: 'frontend',
    title: '前端 / 展示层',
    icon: '🖥️',
    fill: '#fce4ec',
    stroke: '#f48fb1',
    nodeFill: '#fce4ec',
    nodeStroke: '#c2185b',
    nodeColor: '#4a148c',
    match: /front|ui|web|www|static|public|dashboard|pages?|views?|client|html|css|react|vue|next/i
  },
  {
    id: 'api',
    title: '后端 / API 层',
    icon: '🔌',
    fill: '#ede7f6',
    stroke: '#b39ddb',
    nodeFill: '#ede7f6',
    nodeStroke: '#7e57c2',
    nodeColor: '#311b92',
    match: /api|backend|server|gateway|bff|flask|fastapi|express|django|spring|controller|routes?/i
  },
  {
    id: 'schedule',
    title: '调度 / 编排层',
    icon: '⏱️',
    fill: '#fff3e0',
    stroke: '#ffb74d',
    nodeFill: '#fff3e0',
    nodeStroke: '#fb8c00',
    nodeColor: '#e65100',
    match: /schedul|orchestr|cron|celery|beat|dispatcher|pipeline|workflow|airflow|temporal|quartz/i
  },
  {
    id: 'worker',
    title: '采集 / Worker 层',
    icon: '📥',
    fill: '#e8f5e9',
    stroke: '#81c784',
    nodeFill: '#e8f5e9',
    nodeStroke: '#43a047',
    nodeColor: '#1b5e20',
    match: /worker|crawl|scraper|spider|collect|fetcher|ingest|consumer|playwright|selenium|job|batch|etl/i
  },
  {
    id: 'storage',
    title: '数据 / 存储层',
    icon: '💾',
    fill: '#e0f7fa',
    stroke: '#4dd0e1',
    nodeFill: '#e0f7fa',
    nodeStroke: '#00acc1',
    nodeColor: '#006064',
    match: /db|database|postgres|mysql|mongo|redis|sqlite|kafka|rabbit|mq|queue|cache|storage|store|csv|s3|bucket|clickhouse|elastic/i,
    shape: 'cylinder'
  },
  {
    id: 'monitor',
    title: '监控 / 告警层',
    icon: '🔔',
    fill: '#fffde7',
    stroke: '#fff176',
    nodeFill: '#fffde7',
    nodeStroke: '#f9a825',
    nodeColor: '#f57f17',
    match: /monitor|alert|alarm|metric|prometheus|grafana|sentry|notify|smtp|webhook|health|observ/i
  },
  {
    id: 'ops',
    title: '交付 / 运维层',
    icon: '🚀',
    fill: '#e8f5e9',
    stroke: '#81c784',
    nodeFill: '#c8e6c9',
    nodeStroke: '#43a047',
    nodeColor: '#1b5e20',
    match: /deploy|k8s|kube|docker|infra|ops|ci|cd|terraform|helm|nginx|proxy|config|compose/i
  }
];

const LAYER_BY_ID = Object.fromEntries(LAYER_DEFS.map((l) => [l.id, l]));

/** Common English folder/file → short Chinese title (通解启发式，可被 layers.json 覆盖) */
const TITLE_HINTS = [
  [/index\.html|home/i, '首页'],
  [/dashboard/i, '看板'],
  [/frontend|web|ui/i, '前端'],
  [/api|backend|server/i, 'API 服务'],
  [/order/i, '订单'],
  [/pay(ment)?/i, '支付'],
  [/inventor/i, '库存'],
  [/schedul/i, '调度器'],
  [/worker|crawl|spider|scraper/i, '采集 Worker'],
  [/redis/i, '缓存'],
  [/postgres|mysql|mongo|sqlite|database|db/i, '数据库'],
  [/kafka|rabbit|mq|queue/i, '消息队列'],
  [/monitor|alert|alarm/i, '监控告警'],
  [/notify|smtp|webhook/i, '通知'],
  [/docker|compose/i, '容器编排'],
  [/k8s|kube|helm/i, 'K8s 部署'],
  [/config|settings/i, '配置'],
  [/gateway/i, '网关'],
  [/auth|login/i, '认证'],
  [/main\.|app\./i, '主入口']
];

function q(s, max) {
  return String(s || '')
    .replace(/"/g, "'")
    .replace(/\n/g, ' ')
    .slice(0, max || 48);
}

function snake(s) {
  return String(s || '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item';
}

function classifyKind(text) {
  const t = String(text || '');
  for (const layer of LAYER_DEFS) {
    if (layer.match.test(t)) return layer.id;
  }
  return 'api';
}

function chineseTitle(raw) {
  const s = String(raw || '');
  for (const [re, title] of TITLE_HINTS) {
    if (re.test(s)) return title;
  }
  // Keep readable basename without extension if no hint
  const base = path.basename(s).replace(/\.[^.]+$/, '');
  return base || s;
}

function loadLayerOverride(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'architecture.layers.json'),
    path.join(repoRoot, 'architecture_viewer', 'layers.json')
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Build flat list of architecture nodes from scan inventory (+ optional override).
 * Each node: { id, layer, title, sub, icon?, shape? }
 */
function buildLayerNodes(inv, override) {
  const byId = new Map();

  function add(node) {
    if (!node || !node.id) return;
    const id = snake(node.id);
    if (byId.has(id)) return;
    const layer = node.layer || classifyKind([node.title, node.sub, node.id].join(' '));
    const def = LAYER_BY_ID[layer] || LAYER_BY_ID.api;
    byId.set(id, {
      id,
      layer: LAYER_BY_ID[layer] ? layer : 'api',
      title: q(node.title || chineseTitle(node.sub || id), 24),
      sub: q(node.sub || '', 40),
      icon: node.icon || def.icon,
      shape: node.shape || def.shape || 'rect',
      // Module nodes are architecture units: always rendered (exempt from per-layer caps)
      _module: !!node._module
    });
  }

  // 1) Explicit override nodes win first (user-authored: always rendered)
  if (override && Array.isArray(override.nodes)) {
    override.nodes.forEach((n) =>
      add({
        id: n.id,
        layer: n.layer,
        title: n.title,
        sub: n.sub || n.path || n.tech,
        icon: n.icon,
        shape: n.shape,
        _module: true
      })
    );
  }

  // 2) Modules (top-level dirs + nested packages)
  (inv.modules || []).forEach((m) => {
    add({
      id: m.id,
      layer: m.layer || m.kind || classifyKind(m.label),
      title: chineseTitle(m.label),
      sub: m.label,
      _module: true
    });
  });

  // 3) Compose / runtime services
  (inv.services || []).forEach((s) => {
    add({
      id: s.id,
      layer: s.layer || classifyKind(s.label),
      title: chineseTitle(s.label),
      sub: s.source ? `${s.label} · ${s.source}` : s.label
    });
  });

  // 4) Entrypoints
  (inv.entrypoints || []).forEach((e) => {
    add({
      id: snake(e.replace(/\.[^.]+$/, '')),
      layer: classifyKind(e),
      title: chineseTitle(e),
      sub: e
    });
  });

  // 5) Deploy artifacts
  (inv.deploy || []).forEach((d) => {
    add({
      id: snake(d),
      layer: 'ops',
      title: chineseTitle(d),
      sub: d
    });
  });

  // 6) Extra files discovered by scan (artifacts)
  (inv.artifacts || []).forEach((a) => {
    add({
      id: a.id || snake(a.path || a.label),
      layer: a.layer || classifyKind(a.path || a.label),
      title: a.title || chineseTitle(a.label || a.path),
      sub: a.path || a.label
    });
  });

  // Guarantee at least one node
  if (!byId.size) {
    add({
      id: 'app_core',
      layer: 'api',
      title: chineseTitle(inv.title || inv.folder),
      sub: inv.languages && inv.languages[0] ? inv.languages[0] : 'app'
    });
  }

  // Optional: remap layer ids via override.aliases
  if (override && override.aliases && typeof override.aliases === 'object') {
    for (const n of byId.values()) {
      if (override.aliases[n.id]) n.layer = override.aliases[n.id];
    }
  }

  return [...byId.values()];
}

function groupByLayer(nodes, override) {
  const order = (override && Array.isArray(override.order) && override.order.length
    ? override.order
    : LAYER_DEFS.map((l) => l.id)
  ).filter((id) => LAYER_BY_ID[id]);

  const groups = [];
  for (const id of order) {
    const items = nodes.filter((n) => n.layer === id);
    if (!items.length) continue;
    // Module/override nodes are architecture units → always rendered;
    // secondary nodes (artifacts, services, deploy) keep the per-layer cap.
    const keep = items.filter((n) => n._module);
    const extra = items.filter((n) => !n._module).slice(0, 8);
    const layerNodes = [...keep, ...extra].slice(0, 40);
    if (!layerNodes.length) continue;
    const def = LAYER_BY_ID[id];
    const customTitle =
      override && override.titles && override.titles[id] ? override.titles[id] : def.title;
    groups.push({ def: { ...def, title: customTitle }, nodes: layerNodes });
  }

  // Orphans → fold into api
  const known = new Set(order);
  const orphans = nodes.filter((n) => !known.has(n.layer));
  if (orphans.length) {
    let apiGroup = groups.find((g) => g.def.id === 'api');
    if (!apiGroup) {
      apiGroup = { def: LAYER_BY_ID.api, nodes: [] };
      groups.push(apiGroup);
    }
    orphans.slice(0, 6).forEach((n) => {
      if (!apiGroup.nodes.find((x) => x.id === n.id)) apiGroup.nodes.push({ ...n, layer: 'api' });
    });
  }

  return groups;
}

function nodeMermaid(n) {
  const label = `${n.icon} ${n.title}<br/><small>${n.sub || n.id}</small>`;
  if (n.shape === 'cylinder') {
    return `    ${n.id}[("${label}")]`;
  }
  return `    ${n.id}["${label}"]`;
}

/** Default vertical edges between consecutive layers (first node of each). */
function defaultEdges(groups) {
  const edges = [];
  edges.push(`  user -->|访问| ${groups[0].nodes[0].id}`);

  for (let i = 0; i < groups.length - 1; i++) {
    const a = groups[i];
    const b = groups[i + 1];
    const from = a.nodes[0].id;
    const to = b.nodes[0].id;
    let verb = '协作';
    if (a.def.id === 'frontend' && b.def.id === 'api') verb = '调用';
    else if (b.def.id === 'storage') verb = '读写';
    else if (a.def.id === 'schedule' || b.def.id === 'worker') verb = '调度';
    else if (b.def.id === 'monitor') verb = '上报';
    else if (a.def.id === 'ops') verb = '部署';
    edges.push(`  ${from} -->|${verb}| ${to}`);
  }

  // Intra-layer light chain (max 3)
  for (const g of groups) {
    for (let i = 0; i < Math.min(g.nodes.length - 1, 3); i++) {
      edges.push(`  ${g.nodes[i].id} --> ${g.nodes[i + 1].id}`);
    }
  }

  return edges;
}

function renderLayeredFlowchart(inv, opts) {
  const options = Object.assign({}, opts);
  const override = options.override || loadLayerOverride(inv.root || '') || null;
  const nodes = buildLayerNodes(inv, override);
  const groups = groupByLayer(nodes, override);
  if (!groups.length) {
    groups.push({
      def: LAYER_BY_ID.api,
      nodes: [{ id: 'app_core', title: q(inv.title), sub: 'app', icon: '⚙️', shape: 'rect', layer: 'api' }]
    });
  }

  const edges =
    override && Array.isArray(override.edges) && override.edges.length
      ? override.edges.map((e) => {
          if (typeof e === 'string') return '  ' + e.replace(/^\s*user\(\[[^\]]*\]\)/, 'user');
          const from = e.from === 'user' || e.from === '使用者' ? 'user' : e.from;
          return `  ${from} -->|${e.label || '协作'}| ${e.to}`;
        })
      : defaultEdges(groups);

  const edgeBlock = ['  user(["👤 使用者"])', ...edges].join('\n');

  const subgraphs = groups
    .map((g) => {
      const lines = g.nodes.map(nodeMermaid).join('\n');
      return `  subgraph L_${g.def.id}["${g.def.icon} ${g.def.title}"]\n    direction LR\n${lines}\n  end`;
    })
    .join('\n');

  const classDefs = groups
    .map(
      (g) =>
        `  classDef ${g.def.id} fill:${g.def.nodeFill},stroke:${g.def.nodeStroke},color:${g.def.nodeColor},stroke-width:1.5px`
    )
    .concat([
      '  classDef actor fill:#eceff1,stroke:#78909c,color:#37474f,stroke-width:1.5px'
    ])
    .join('\n');

  const classAssigns = groups
    .map((g) => `  class ${g.nodes.map((n) => n.id).join(',')} ${g.def.id}`)
    .concat(['  class user actor'])
    .join('\n');

  const styles = groups
    .map(
      (g) =>
        `  style L_${g.def.id} fill:${g.def.fill}88,stroke:${g.def.stroke},stroke-width:2px`
    )
    .join('\n');

  return `flowchart TB
${subgraphs}

${edgeBlock}

${classDefs}
${classAssigns}
${styles}`;
}

function blockDiagramMarkdown(inv, opts) {
  const body = renderLayeredFlowchart(inv, opts);
  const layersUsed = groupByLayer(
    buildLayerNodes(inv, (opts && opts.override) || loadLayerOverride(inv.root || '') || null),
    (opts && opts.override) || loadLayerOverride(inv.root || '') || null
  )
    .map((g) => g.def.title)
    .join(' · ');

  return `# Block Diagram — 分层模块

> 通解生成：按语义自动分层（${layersUsed || '自适应'}）。可用 \`architecture.layers.json\` 覆盖层名/节点/边。

## 子图1：分层全景

\`\`\`mermaid
${body}
\`\`\`

## 子图2：主链路

\`\`\`mermaid
flowchart LR
  u(["👤 使用者"]) --> e["入口<br/><small>${q((inv.entrypoints && inv.entrypoints[0]) || 'main')}</small>"]
  e --> m["模块<br/><small>${q((inv.modules || []).map((x) => x.label).slice(0, 4).join(' · ') || inv.folder)}</small>"]
  m --> d["数据 / 配置"]
  classDef n fill:#fff8e1,stroke:#ffb74d,color:#e65100,stroke-width:1.5px
  class e,m,d n
\`\`\`
`;
}

module.exports = {
  LAYER_DEFS,
  classifyKind,
  chineseTitle,
  loadLayerOverride,
  buildLayerNodes,
  groupByLayer,
  renderLayeredFlowchart,
  blockDiagramMarkdown
};
