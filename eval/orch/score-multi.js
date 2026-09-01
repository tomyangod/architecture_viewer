'use strict';

/**
 * Multi-repo deliverable scorer for usage1 / orch3 block diagrams.
 * Usage: node eval/orch/score-multi.js <repo> <block.md> [<repo> <block.md> ...]
 */

const fs = require('fs');
const path = require('path');
const {
  buildTree, lintBlockDiagram, layerGate, findAnchors, coverageGate, semanticTraps
} = require('./lib');

function deliverableScore({ hallu, layerErr, lintN, anchors, covered, traps, metrics }) {
  let fact = 4;
  if (hallu > 0) fact -= Math.min(4, hallu);
  if (layerErr > 0) fact -= Math.min(2, layerErr * 0.5);

  const covRatio = anchors === 0 ? 1 : covered / anchors;
  const cov = covRatio * 3;

  let style = 2;
  if ((metrics.classDef数 || 0) === 0) style -= 0.8;
  if ((metrics.带中文标签边数 || 0) === 0) style -= 0.6;
  const nodes = metrics.节点数 || 0;
  if (nodes > 30 || nodes < 10) style -= 0.4;
  if (lintN > 0) style -= Math.min(0.8, lintN * 0.2);
  style = Math.max(0, style);

  const trapPen = traps.length ? 1 : 0;
  const raw = Math.max(0, fact + cov + style - trapPen);
  return Math.round(Math.min(10, (raw / 9) * 10) * 10) / 10;
}

function scoreOne(repo, mdPath) {
  const md = fs.readFileSync(mdPath, 'utf8');
  const tree = buildTree(repo);
  const lint = lintBlockDiagram(md, tree);
  const layer = layerGate(md);
  const anchors = findAnchors(tree);
  const missing = coverageGate(md, anchors);
  const traps = semanticTraps(md);
  const covered = anchors.length - missing.length;
  const score = deliverableScore({
    hallu: lint.metrics.幻觉路径数 || 0,
    layerErr: layer.length,
    lintN: lint.issues.length,
    anchors: anchors.length,
    covered,
    traps,
    metrics: lint.metrics
  });
  return {
    repo: path.basename(repo),
    md: mdPath,
    score,
    hallu: lint.metrics.幻觉路径数 || 0,
    layerErr: layer.length,
    lintN: lint.issues.length,
    nodes: lint.metrics.节点数,
    edges: lint.metrics.边数,
    layers: lint.metrics.分层数,
    classDef: lint.metrics.classDef数,
    anchors: anchors.length,
    covered,
    missing: missing.map((a) => a.path),
    traps,
    metrics: lint.metrics
  };
}

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2 !== 0) {
  console.error('Usage: node score-multi.js <repo> <md> ...');
  process.exit(2);
}
const rows = [];
for (let i = 0; i < args.length; i += 2) {
  rows.push(scoreOne(args[i], args[i + 1]));
}
const avg = rows.reduce((s, r) => s + r.score, 0) / rows.length;
console.log(JSON.stringify({ avg: Math.round(avg * 10) / 10, rows }, null, 2));
