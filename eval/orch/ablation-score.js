'use strict';

/**
 * 路由消融机评：双引擎 A 的「冠军引擎」vs「走错路的引擎」
 * 用法: node eval/orch/ablation-score.js [--json out.json]
 *
 * 不比较用法8全文（explore JSON → orch8）——该管线不存在。
 * 本脚本回答：分流是否真的带来机评收益。
 */

const fs = require('fs');
const path = require('path');

// Reuse combat-score internals by spawning the same scoring via require of sibling
// We duplicate the thin table layer; scoring functions live in combat-score.js
// but are not exported. Load by extracting via a local copy of scoreOne.

const lib = require('./lib');
const { visualGates, notifyDirectionGate, structureGates } = require('./run');

const REPO_ROOT = process.env.REPO_ROOT || '/tmp/arch-orch/repos';
const OUT = process.env.OUT || '/tmp/arch-orch/out';

const WEB = [
  { repo: 'changedetection.io', short: 'changedetection', set: 'web' },
  { repo: 'listmonk', short: 'listmonk', set: 'web' },
  { repo: 'uptime-kuma', short: 'uptime-kuma', set: 'web' },
  { repo: 'memos', short: 'memos', set: 'web' },
  { repo: 'umami', short: 'umami', set: 'web' }
];
const EDGE = [
  { repo: 'ntfy', short: 'ntfy', set: 'edge' },
  { repo: 'vaultwarden', short: 'vaultwarden', set: 'edge' },
  { repo: 'zigbee2mqtt', short: 'zigbee2mqtt', set: 'edge' },
  { repo: 'caddy', short: 'caddy', set: 'edge' }
];

function mdPath(spec, variant) {
  const { repo, short } = spec;
  if (variant === 'usage1') return path.join(OUT, 'usage1-' + short, 'block-diagram.md');
  if (variant === 'usage7s') return path.join(OUT, 'usage7s-' + short, 'block-diagram.md');
  if (variant === 'orch4') {
    const edge = path.join(OUT, 'edge-p1shape', 'orch4', repo, 'block-diagram.md');
    if (fs.existsSync(edge)) return edge;
    return path.join(OUT, 'orch4', repo, 'block-diagram.md');
  }
  throw new Error('bad variant ' + variant);
}

function scoreOne(spec, variant) {
  const root = path.join(REPO_ROOT, spec.repo);
  const f = mdPath(spec, variant);
  if (!fs.existsSync(root)) return { missing: 'repo:' + root };
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
  const visual = visualGates(md);
  const structure = structureGates(md, anchors, importance, [spec.repo, spec.short]);
  const notify = notifyDirectionGate(md, anchors, companions);
  const vHigh = visual.filter((v) => v.severity === 'high').length;
  const sHigh = structure.filter((s) => s.severity === 'high').length;
  const hallu = lint.metrics.幻觉路径数 || 0;
  const notifyRev = notify.length;
  const hardFail = [];
  if (hallu !== 0) hardFail.push('hallu=' + hallu);
  if (sHigh !== 0) hardFail.push('structHigh=' + sHigh);
  if (vHigh !== 0) hardFail.push('visualHigh=' + vHigh);
  if (notifyRev !== 0 && importance.shape && importance.shape.kind === 'notify-bus') {
    hardFail.push('notifyRev=' + notifyRev);
  }
  const verdict = hardFail.length ? 'FAIL' : 'PASS_HARD';
  return {
    path: f,
    hallu,
    structHigh: sHigh,
    visualHigh: vHigh,
    layerErr: layer.length,
    notifyRev,
    nodes: lint.metrics.节点数,
    hardFail,
    verdict,
    hsv: `${hallu}/${sHigh}/${vHigh}`
  };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function main() {
  const argv = process.argv.slice(2);
  let jsonOut = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') jsonOut = argv[++i];
  }

  const rows = [];
  for (const spec of [...WEB, ...EDGE]) {
    const champ = spec.set === 'web' ? 'usage7s' : 'orch4';
    const off = spec.set === 'web' ? 'orch4' : 'usage7s';
    const scored = {
      repo: spec.repo,
      short: spec.short,
      set: spec.set,
      champion: champ,
      offroute: off,
      usage1: scoreOne(spec, 'usage1'),
      usage7s: scoreOne(spec, 'usage7s'),
      orch4: scoreOne(spec, 'orch4'),
      u8: { missing: 'NOT_IMPLEMENTED: explore JSON → orch8' }
    };
    scored.champScore = scored[champ];
    scored.offScore = scored[off];
    scored.routingHelps =
      !scored.champScore.missing &&
      (scored.offScore.missing ||
        scored.champScore.verdict !== 'FAIL' &&
          (scored.offScore.verdict === 'FAIL' ||
            scored.champScore.hallu + scored.champScore.structHigh + scored.champScore.visualHigh <=
              scored.offScore.hallu + scored.offScore.structHigh + scored.offScore.visualHigh));
    rows.push(scored);
  }

  const web = rows.filter((r) => r.set === 'web');
  const edge = rows.filter((r) => r.set === 'edge');
  const webChampPass = web.every((r) => r.champScore.verdict === 'PASS_HARD' || r.champScore.verdict === 'PASS_FULL');
  const webOffPass = web.every((r) => !r.offScore.missing && r.offScore.verdict !== 'FAIL');
  const edgeChampPass = edge.every((r) => r.champScore.verdict === 'PASS_HARD' || r.champScore.verdict === 'PASS_FULL');
  const edgeOffPass = edge.every((r) => !r.offScore.missing && r.offScore.verdict !== 'FAIL');

  const summary = {
    generated_at: new Date().toISOString(),
    question: 'Does dual-engine routing beat using the other engine on the same set?',
    u8_full: 'NOT_IMPLEMENTED',
    web: {
      champion: 'usage7s',
      offroute: 'orch4',
      champPassHard: webChampPass,
      offPassHard: webOffPass,
      routingHelpsN: web.filter((r) => r.routingHelps).length + '/' + web.length
    },
    edge: {
      champion: 'orch4',
      offroute: 'usage7s',
      champPassHard: edgeChampPass,
      offPassHard: edgeOffPass,
      routingHelpsN: edge.filter((r) => r.routingHelps).length + '/' + edge.length
    },
    verdict:
      webChampPass && edgeChampPass && (!webOffPass || !edgeOffPass)
        ? 'ROUTING_JUSTIFIED_MACHINE'
        : webChampPass && edgeChampPass && webOffPass && edgeOffPass
          ? 'BOTH_ENGINES_PASS_HARD_ROUTING_NEUTRAL_ON_MACHINE'
          : 'ROUTING_NOT_JUSTIFIED_ON_MACHINE'
  };

  console.log('\n=== ROUTING ABLATION (双引擎 A · 冠军 vs 走错路) ===\n');
  console.log('用法8全文 (explore JSON→orch8): NOT_IMPLEMENTED — 无法直接对比\n');
  console.log(
    pad('repo', 18) +
      pad('set', 6) +
      pad('A.champ', 10) +
      pad('c.h/s/v', 10) +
      pad('off-route', 10) +
      pad('o.h/s/v', 10) +
      pad('u1.h/s/v', 10) +
      'routing?'
  );
  for (const r of rows) {
    console.log(
      pad(r.short, 18) +
        pad(r.set, 6) +
        pad(r.champion, 10) +
        pad(r.champScore.missing ? 'MISS' : r.champScore.hsv + ' ' + r.champScore.verdict.replace('PASS_', ''), 10) +
        pad(r.offroute, 10) +
        pad(r.offScore.missing ? 'MISS' : r.offScore.hsv + ' ' + (r.offScore.verdict || '').replace('PASS_', ''), 10) +
        pad(r.usage1.missing ? 'MISS' : r.usage1.hsv, 10) +
        (r.routingHelps ? 'helps' : 'no')
    );
  }
  console.log('\n--- 集合 ---');
  console.log('Web  冠军7s PASS_HARD:', webChampPass, '| 错路 orch4 PASS_HARD:', webOffPass);
  console.log('Edge 冠军o4 PASS_HARD:', edgeChampPass, '| 错路 7s   PASS_HARD:', edgeOffPass);
  console.log('机评分流判定:', summary.verdict);

  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify({ summary, rows }, null, 2));
    console.log('\nJSON →', jsonOut);
  }
}

main();
