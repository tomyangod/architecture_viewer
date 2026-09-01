'use strict';

/**
 * Score usage1 vs orch4 / usage7s for arbitrary repos under /tmp/arch-orch.
 * Usage: node eval/orch/score-edge.js [--variants usage1,orch4,usage7s] repo1 [repo2 ...]
 */

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const { visualGates, notifyDirectionGate, optionalLabelGate, structureGates } = require('./run');

const REPO_ROOT = process.env.REPO_ROOT || '/tmp/arch-orch/repos';
const OUT = process.env.OUT || '/tmp/arch-orch/out';

function mdPath(repo, variant) {
  if (variant === 'usage1') return path.join(OUT, 'usage1-' + repo, 'block-diagram.md');
  if (variant === 'orch4') return path.join(OUT, 'orch4', repo, 'block-diagram.md');
  if (variant === 'usage7s') return path.join(OUT, 'usage7s-' + repo, 'block-diagram.md');
  if (variant === 'usage7g') return path.join(OUT, 'usage7g-' + repo, 'block-diagram.md');
  throw new Error('bad variant');
}

function scoreOne(repo, variant) {
  const root = path.join(REPO_ROOT, repo);
  const f = mdPath(repo, variant);
  if (!fs.existsSync(f)) return { missing: f };
  const md = fs.readFileSync(f, 'utf8');
  const tree = lib.buildTree(root);
  const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));
  const inv = scan(root);
  const importance = lib.importanceForensics(root, tree, inv.entrypoints);
  const anchors = lib.findAnchorsV2(tree, importance);
  const companions = lib.anchorCompanions(tree, anchors, importance);
  const lint = lib.lintBlockDiagram(md, tree);
  const layer = lib.layerGate(md);
  const missingAnchors = lib.coverageGate(md, anchors);
  const traps = lib.semanticTraps(md);
  const visual = visualGates(md);
  const structure = structureGates(md, anchors, importance, [repo]);
  const notify = notifyDirectionGate(md, anchors, companions);
  const optional = optionalLabelGate(md, importance, importance.detachedList.map((d) => path.basename(d.path)));
  const vHigh = visual.filter((v) => v.severity === 'high').length;
  const sHigh = structure.filter((s) => s.severity === 'high').length;
  return {
    hallu: lint.metrics.幻觉路径数 || 0,
    layerErr: layer.length,
    lintN: lint.issues.length,
    layerIssues: layer.slice(0, 6),
    visualHigh: vHigh,
    structHigh: sHigh,
    structIssues: structure.filter((s) => s.severity === 'high').map((s) => s.issue).slice(0, 6),
    visualIssues: visual.filter((v) => v.severity === 'high').map((v) => v.issue).slice(0, 6),
    traps: traps.length,
    notifyReversed: notify.length,
    optionalUnlabeled: optional.length,
    anchors: `${anchors.length - missingAnchors.length}/${anchors.length}`,
    missingAnchors: missingAnchors.map((a) => a.path),
    hasCloseup: (lib.parseMermaid(md).length || 0) >= 2,
    nodes: lint.metrics.节点数,
    edges: lint.metrics.边数,
    layers: lint.metrics.分层数,
    lintIssues: lint.issues.slice(0, 8)
  };
}

const argv = process.argv.slice(2);
let variants = ['usage1', 'orch4', 'usage7s'];
const repos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--variants') variants = argv[++i].split(',');
  else repos.push(argv[i]);
}
if (!repos.length) {
  console.error('Usage: node score-edge.js [--variants usage1,orch4,usage7s] <repo>...');
  process.exit(2);
}
const all = repos.map((repo) => {
  const row = { repo };
  for (const v of variants) row[v] = scoreOne(repo, v);
  return row;
});
console.log(JSON.stringify(all, null, 2));
