'use strict';
// 临时探针：对 usage7g 五仓产物跑现有闸门 + deterministicSweep，看行为
const fs = require('fs');
const path = require('path');
const { buildTree, parseMermaid, parseFlowchart, importanceForensics, findAnchorsV2, lintBlockDiagram, anchorCompanions } = require('./lib');
const { structureGates, deterministicSweep, visualGates, notifyDirectionGate } = require('./run');
const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));

const REPOS = '/tmp/arch-orch/repos';
const OUT = '/tmp/arch-orch/out';
const REPOS_ALL = [
  { name: 'changedetection.io', short: 'changedetection' },
  { name: 'listmonk', short: 'listmonk' },
  { name: 'uptime-kuma', short: 'uptime-kuma' },
  { name: 'memos', short: 'memos' },
  { name: 'umami', short: 'umami' }
];

for (const spec of REPOS_ALL) {
  const mdPath = path.join(OUT, 'usage7g-' + spec.short, 'block-diagram.md');
  const md = fs.readFileSync(mdPath, 'utf8');
  const root = path.join(REPOS, spec.name);
  const tree = buildTree(root);
  const inv = scan(root);
  const importance = importanceForensics(root, tree, inv.entrypoints);
  const anchors = findAnchorsV2(tree, importance);
  const companions = anchorCompanions(tree, anchors, importance);

  console.log('\n========== ' + spec.name + ' ==========');
  const blocks = parseMermaid(md);
  blocks.forEach((code, bi) => {
    const pf = parseFlowchart(code);
    const deg = new Map();
    for (const e of pf.edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
    const isolated = pf.nodeIds.filter((id) => !deg.has(id));
    const pairSet = new Set(pf.edges.map((e) => e.from + '>' + e.to));
    const cycles = pf.edges.filter((e) => pairSet.has(e.to + '>' + e.from)).map((e) => e.from + '<->' + e.to);
    console.log('块' + bi + ': 节点=' + pf.nodeIds.length + ' 边=' + pf.edges.length + ' 孤立=[' + isolated.join(',') + '] 双向=[' + [...new Set(cycles)].join(',') + ']');
  });

  const sg = structureGates(md, anchors, importance);
  const hi = sg.filter((i) => i.sev === 'high');
  const med = sg.filter((i) => i.sev === 'medium');
  console.log('structureGates high=' + hi.length + ' medium=' + med.length);
  for (const i of [...hi, ...med].slice(0, 12)) console.log('  [' + i.sev + '] ' + i.msg);

  const vg = visualGates(md);
  console.log('visualGates: ' + vg.slice(0, 6).map((i) => i.msg).join(' | '));

  const nd = notifyDirectionGate(md, anchors, companions);
  if (nd.length) console.log('notifyGate: ' + nd.map((i) => i.msg).join(' | '));

  const lint = lintBlockDiagram(md, tree);
  console.log('lint 幻觉=' + lint.metrics.幻觉路径数 + ' issues=' + lint.issues.length);

  const sweptRes = deterministicSweep(md, anchors);
  const swept = sweptRes.md;
  const changed = swept !== md;
  console.log('deterministicSweep changed=' + changed + ' actions=' + (sweptRes.actions || []).length);
  if (changed) {
    for (const act of (sweptRes.actions || []).slice(0, 10)) console.log('  action: ' + JSON.stringify(act).slice(0, 160));
    const a = md.split('\n'), b = swept.split('\n');
    let diffs = 0;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n && diffs < 8; i++) {
      if (a[i] !== b[i]) { console.log('  L' + (i + 1) + ' -: ' + (a[i] || '').slice(0, 110)); console.log('  L' + (i + 1) + ' +: ' + (b[i] || '').slice(0, 110)); diffs++; }
    }
    const pf2 = parseFlowchart(parseMermaid(swept)[0]);
    console.log('  扫后块0: 节点=' + pf2.nodeIds.length + ' 边=' + pf2.edges.length);
    fs.writeFileSync(path.join(OUT, 'usage7g-' + spec.short, 'swept-by-runjs.md'), swept);
  }
}
