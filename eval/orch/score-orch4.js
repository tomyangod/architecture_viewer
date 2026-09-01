'use strict';

/**
 * orch4 五仓机评：用法1 vs orch3 vs orch4。
 * 用法: node eval/orch/score-orch4.js
 * 产物约定：
 *   仓库:     /tmp/arch-orch/repos/<repo>
 *   用法1:    /tmp/arch-orch/out/usage1-<repo>/block-diagram.md
 *   orch3:    /tmp/arch-orch/out/orch3-<repo>/block-diagram.md（changedetection 为 orch3/）
 *   orch4:    /tmp/arch-orch/out/orch4/<repo>/block-diagram.md
 *   orch4 状态: /tmp/arch-orch/out/orch4/<repo>/state.json（取 actorList）
 */

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const { visualGates, notifyDirectionGate, optionalLabelGate, structureGates } = require('./run');

const REPOS = ['changedetection.io', 'listmonk', 'uptime-kuma', 'memos', 'umami'];
const REPO_ROOT = '/tmp/arch-orch/repos';
const OUT = '/tmp/arch-orch/out';

function mdPath(repo, variant) {
  const short = repo.replace(/\.io$/, '');
  if (variant === 'usage1') return path.join(OUT, 'usage1-' + short, 'block-diagram.md');
  if (variant === 'orch3') {
    if (repo === 'changedetection.io') return path.join(OUT, 'orch3', 'block-diagram.md');
    return path.join(OUT, 'orch3-' + short, 'block-diagram.md');
  }
  if (variant === 'orch4') return path.join(OUT, 'orch4', repo, 'block-diagram.md');
  throw new Error('bad variant');
}

function scoreRepo(repo) {
  const root = path.join(REPO_ROOT, repo);
  const tree = lib.buildTree(root);
  const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));
  const inv = scan(root);
  const importance = lib.importanceForensics(root, tree, inv.entrypoints);
  const anchors = lib.findAnchorsV2(tree, importance);
  const companions = lib.anchorCompanions(tree, anchors, importance);

  // actor 基准：优先 orch4 state.json 的 actorList，否则空
  let actorNames = [];
  const statePath = path.join(OUT, 'orch4', repo, 'state.json');
  try {
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    actorNames = (st.actorList || (st.brief && st.brief.actors) || []).map((a) => a.name || a);
  } catch { /* state 未落盘则跳过 actor 覆盖 */ }

  const rows = {};
  for (const variant of ['usage1', 'orch3', 'orch4']) {
    const f = mdPath(repo, variant);
    if (!fs.existsSync(f)) { rows[variant] = { missing: f }; continue; }
    const md = fs.readFileSync(f, 'utf8');
    const lint = lib.lintBlockDiagram(md, tree);
    const layer = lib.layerGate(md);
    const missingAnchors = lib.coverageGate(md, anchors);
    const traps = lib.semanticTraps(md);
    const visual = visualGates(md);
    const structure = structureGates(md, anchors, importance, [repo, repo.replace(/\.io$/, '')]);
    const notify = notifyDirectionGate(md, anchors, companions);
    const optional = optionalLabelGate(md, importance, importance.detachedList.map((d) => path.basename(d.path)));
    // 配套执行器覆盖：
    //  - 同级独立执行器（notification_service.py / worker_pool.py）：路径必须逐字出场
    //  - 锚点包内部组成（store/store.go 在锚点目录 store/ 内）：锚点目录自身作为节点出场即视为覆盖
    const nodeSmallPaths = new Set();
    for (const s of md.match(/<small>([\s\S]*?)<\/small>/g) || []) {
      nodeSmallPaths.add(s.replace(/<\/?small>/g, '').trim().replace(/\/$/, ''));
    }
    const companionHits = companions.filter((c) => {
      if (md.includes(c.path)) return true;
      const inDir = path.dirname(c.path) === c.companionOf;
      return inDir && nodeSmallPaths.has(c.companionOf);
    }).length;
    // actor 覆盖
    const actorHits = actorNames.filter((n) => md.includes(n)).length;
    // 子图2 特写
    const hasCloseup = (lib.parseMermaid(md).length || 0) >= 2;

    const hallu = lint.metrics.幻觉路径数 || 0;
    const vHigh = visual.filter((v) => v.severity === 'high').length;
    const vMed = visual.filter((v) => v.severity === 'medium').length;
    const sHigh = structure.filter((s) => s.severity === 'high').length;
    const sMed = structure.filter((s) => s.severity === 'medium').length;
    rows[variant] = {
      hallu,
      layerErr: layer.length,
      lintN: lint.issues.length,
      anchorTotal: anchors.length,
      anchorCovered: anchors.length - missingAnchors.length,
      missingAnchors: missingAnchors.map((a) => a.path),
      traps: traps.length,
      visualHigh: vHigh,
      visualMed: vMed,
      structHigh: sHigh,
      structMed: sMed,
      structIssues: structure.filter((s) => s.severity === 'high' || s.severity === 'medium').map((s) => `[${s.severity}/${s.kind}] ${s.issue}`),
      notifyReversed: notify.length,
      optionalUnlabeled: optional.length,
      companionHits,
      companionTotal: companions.length,
      actorHits,
      actorTotal: actorNames.length,
      hasCloseup,
      nodes: lint.metrics.节点数,
      edges: lint.metrics.边数,
      issues: [
        ...traps.map((t) => 'trap: ' + t),
        ...notify.map((t) => 'notify: ' + t.issue),
        ...optional.map((t) => 'optional: ' + t),
        ...visual.map((t) => `visual(${t.severity}): ` + t.issue),
        ...structure.map((t) => `structure(${t.severity}): ` + t.issue)
      ]
    };
  }
  return { repo, rows };
}

const all = REPOS.map(scoreRepo);

// 汇总表
console.log('repo | variant | 幻觉 层错 lint | 锚点覆盖 | 陷阱 视高 视中 结高 结中 通知反 可选未标 | 配套 actor 子图2 | 节点/边');
for (const { repo, rows } of all) {
  for (const v of ['usage1', 'orch3', 'orch4']) {
    const r = rows[v];
    if (!r || r.missing) { console.log(`${repo} | ${v} | MISSING ${r ? r.missing : ''}`); continue; }
    console.log(`${repo} | ${v} | ${r.hallu} ${r.layerErr} ${r.lintN} | ${r.anchorCovered}/${r.anchorTotal} | ${r.traps} ${r.visualHigh} ${r.visualMed} ${r.structHigh} ${r.structMed} ${r.notifyReversed} ${r.optionalUnlabeled} | ${r.companionHits}/${r.companionTotal} ${r.actorHits}/${r.actorTotal} ${r.hasCloseup ? 'Y' : 'N'} | ${r.nodes}/${r.edges}`);
  }
}
fs.writeFileSync(path.join(OUT, 'orch4-machine-score.json'), JSON.stringify(all, null, 2));
console.log('\n详细 JSON: /tmp/arch-orch/out/orch4-machine-score.json');
