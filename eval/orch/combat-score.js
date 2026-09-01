'use strict';

/**
 * 双引擎 vs 用法1 · 统一机评实战
 * 用法: node eval/orch/combat-score.js [--json out.json] [--md SCORE-COMBAT.md]
 *
 * 冠军映射：Web 五仓 → usage7s；Edge 四仓 → orch4（优先 edge-p1shape）
 * 评分规则见 SCORE-COMBAT.md
 */

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const { visualGates, notifyDirectionGate, optionalLabelGate, structureGates } = require('./run');

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
const ALL = [...WEB, ...EDGE];

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

function championOf(spec) {
  return spec.set === 'web' ? 'usage7s' : 'orch4';
}

function scoreOne(spec, variant) {
  const root = path.join(REPO_ROOT, spec.repo);
  const f = mdPath(spec, variant);
  if (!fs.existsSync(root)) return { missing: 'repo:' + root };
  if (!fs.existsSync(f)) return { missing: f };
  const md = fs.readFileSync(f, 'utf8');
  const mtime = fs.statSync(f).mtime.toISOString();
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
  const optional = optionalLabelGate(md, importance, (importance.detachedList || []).map((d) => path.basename(d.path)));
  const vHigh = visual.filter((v) => v.severity === 'high').length;
  const sHigh = structure.filter((s) => s.severity === 'high').length;
  const hallu = lint.metrics.幻觉路径数 || 0;
  const layerErr = layer.length;
  const anchorCov = anchors.length ? (anchors.length - missingAnchors.length) / anchors.length : 1;
  const hasCloseup = (lib.parseMermaid(md).length || 0) >= 2;
  const notifyRev = notify.length;

  const hardFail = [];
  if (hallu !== 0) hardFail.push('hallu=' + hallu);
  if (sHigh !== 0) hardFail.push('structHigh=' + sHigh);
  if (vHigh !== 0) hardFail.push('visualHigh=' + vHigh);
  if (notifyRev !== 0 && importance.shape && importance.shape.kind === 'notify-bus') {
    hardFail.push('notifyRev=' + notifyRev);
  }

  const softFail = [];
  if (layerErr > 2) softFail.push('layerErr=' + layerErr);
  if (anchorCov < 0.8 && missingAnchors.length) softFail.push('anchorCov=' + anchorCov.toFixed(2));
  if (!hasCloseup) softFail.push('noCloseup');

  let verdict = 'PASS_FULL';
  if (hardFail.length) verdict = 'FAIL';
  else if (softFail.length) verdict = 'PASS_HARD';

  return {
    path: f,
    mtime,
    shape: importance.shape && importance.shape.kind,
    hallu,
    structHigh: sHigh,
    visualHigh: vHigh,
    layerErr,
    notifyRev,
    optionalUnlabeled: optional.length,
    anchors: `${anchors.length - missingAnchors.length}/${anchors.length}`,
    anchorCov: +anchorCov.toFixed(3),
    missingAnchors: missingAnchors.map((a) => a.path),
    hasCloseup,
    nodes: lint.metrics.节点数,
    edges: lint.metrics.边数,
    layers: lint.metrics.分层数,
    hardFail,
    softFail,
    verdict,
    structIssues: structure.filter((s) => s.severity === 'high').map((s) => s.issue).slice(0, 4),
    visualIssues: visual.filter((v) => v.severity === 'high').map((v) => v.issue).slice(0, 4)
  };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function main() {
  const argv = process.argv.slice(2);
  let jsonOut = null;
  let mdOut = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') jsonOut = argv[++i];
    else if (argv[i] === '--md') mdOut = argv[++i];
  }

  const rows = [];
  for (const spec of ALL) {
    const champ = championOf(spec);
    const variants = ['usage1', 'usage7s', 'orch4'];
    const scored = { repo: spec.repo, short: spec.short, set: spec.set, champion: champ };
    for (const v of variants) scored[v] = scoreOne(spec, v);
    scored.champVerdict = scored[champ].verdict || 'MISSING';
    scored.usage1Verdict = scored.usage1.verdict || 'MISSING';
    scored.beatUsage1Hard =
      !scored[champ].missing &&
      !scored.usage1.missing &&
      scored.champVerdict !== 'FAIL' &&
      (scored.usage1Verdict === 'FAIL' ||
        (scored[champ].hallu + scored[champ].structHigh + scored[champ].visualHigh) <=
          (scored.usage1.hallu + scored.usage1.structHigh + scored.usage1.visualHigh));
    rows.push(scored);
  }

  const web = rows.filter((r) => r.set === 'web');
  const edge = rows.filter((r) => r.set === 'edge');
  const webChampPass = web.every((r) => r.champVerdict === 'PASS_HARD' || r.champVerdict === 'PASS_FULL');
  const edgeChampPass = edge.every((r) => r.champVerdict === 'PASS_HARD' || r.champVerdict === 'PASS_FULL');
  const webFull = web.every((r) => r.champVerdict === 'PASS_FULL');
  const edgeFull = edge.every((r) => r.champVerdict === 'PASS_FULL');

  const summary = {
    generated_at: new Date().toISOString(),
    code: 'combat-score.js + lib/orch gates (current workspace)',
    rule: 'SCORE-COMBAT.md §2',
    web: {
      champion: 'usage7s',
      n: web.length,
      passHard: webChampPass,
      passFull: webFull,
      verdicts: Object.fromEntries(web.map((r) => [r.short, r.champVerdict]))
    },
    edge: {
      champion: 'orch4@edge-p1shape-preferred',
      n: edge.length,
      passHard: edgeChampPass,
      passFull: edgeFull,
      verdicts: Object.fromEntries(edge.map((r) => [r.short, r.champVerdict]))
    },
    plan_s1_1_machine: webChampPass && edgeChampPass ? 'PASS' : 'FAIL',
    plan_s1_2_blind: 'NOT_RUN_THIS_CAMPAIGN',
    plan_s1_3_stability: 'NOT_RUN_THIS_CAMPAIGN',
    campaign: webChampPass && edgeChampPass
      ? '机评实战通过 / 盲评待战役'
      : '机评实战未通过'
  };

  // Console table
  console.log('\n=== COMBAT MACHINE SCORE (双引擎冠军 vs 用法1) ===\n');
  console.log(
    pad('repo', 18) +
      pad('set', 5) +
      pad('champ', 8) +
      pad('c.verdict', 11) +
      pad('c.h/s/v', 8) +
      pad('u1.verdict', 11) +
      pad('u1.h/s/v', 8) +
      'mtime(champ)'
  );
  for (const r of rows) {
    const c = r[r.champion];
    const u = r.usage1;
    const chsv = c.missing
      ? 'MISS'
      : `${c.hallu}/${c.structHigh}/${c.visualHigh}`;
    const uhsv = u.missing
      ? 'MISS'
      : `${u.hallu}/${u.structHigh}/${u.visualHigh}`;
    console.log(
      pad(r.short, 18) +
        pad(r.set, 5) +
        pad(r.champion, 8) +
        pad(c.verdict || 'MISS', 11) +
        pad(chsv, 8) +
        pad(u.verdict || 'MISS', 11) +
        pad(uhsv, 8) +
        (c.mtime || '').slice(0, 16)
    );
  }

  console.log('\n--- 集合判定 ---');
  console.log('Web 五仓冠军(usage7s) PASS_HARD:', webChampPass, summary.web.verdicts);
  console.log('Edge 四仓冠军(orch4)   PASS_HARD:', edgeChampPass, summary.edge.verdicts);
  console.log('PLAN §1.1 机评:', summary.plan_s1_1_machine);
  console.log('PLAN §1.2 盲评:', summary.plan_s1_2_blind);
  console.log('PLAN §1.3 稳定:', summary.plan_s1_3_stability);
  console.log('战役结论:', summary.campaign);

  // Fail detail
  for (const r of rows) {
    const c = r[r.champion];
    if (c.missing || c.verdict === 'FAIL') {
      console.log('\n[FAIL DETAIL]', r.short, r.champion, c.missing || '', c.hardFail || [], c.structIssues || []);
    }
  }

  const payload = { summary, rows };
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
    console.log('\nJSON →', jsonOut);
  }

  if (mdOut && fs.existsSync(mdOut)) {
    let md = fs.readFileSync(mdOut, 'utf8');
    const block = [
      '',
      '## 7. 本机战役记录（机评实战）',
      '',
      `生成时间：${summary.generated_at}`,
      '',
      `| 集合 | 冠军 | PASS_HARD | PASS_FULL | §1.1 |`,
      `|------|------|:---------:|:---------:|------|`,
      `| Web 五仓 | usage7s | ${webChampPass ? '✅' : '❌'} | ${webFull ? '✅' : '❌'} | ${summary.plan_s1_1_machine} |`,
      `| Edge 四仓 | orch4 | ${edgeChampPass ? '✅' : '❌'} | ${edgeFull ? '✅' : '❌'} | ${summary.plan_s1_1_machine} |`,
      '',
      '**盲评：** 本战役未跑（`NOT_RUN_THIS_CAMPAIGN`）。历史盲评见 SCORE-EDGE-ACCEPT / SCORE-U7S-VS-U8，不得计入本战役总分。',
      '',
      '**战役结论：** ' + summary.campaign,
      '',
      '### 逐仓冠军硬闸',
      '',
      '| 仓 | 冠军 | verdict | hallu | structH | visualH | anchors | closeup |',
      '|----|------|---------|------:|--------:|--------:|---------|:-------:|'
    ];
    for (const r of rows) {
      const c = r[r.champion];
      if (c.missing) {
        block.push(`| ${r.short} | ${r.champion} | MISSING | — | — | — | — | — |`);
      } else {
        block.push(
          `| ${r.short} | ${r.champion} | **${c.verdict}** | ${c.hallu} | ${c.structHigh} | ${c.visualHigh} | ${c.anchors} | ${c.hasCloseup ? 'Y' : 'N'} |`
        );
      }
    }
    block.push('');
    const marker = '## 7. 本机战役记录';
    if (md.includes(marker)) {
      md = md.slice(0, md.indexOf(marker)) + block.join('\n');
    } else {
      md = md.trimEnd() + '\n' + block.join('\n');
    }
    fs.writeFileSync(mdOut, md);
    console.log('MD  →', mdOut);
  }

  process.exit(summary.plan_s1_1_machine === 'PASS' ? 0 : 1);
}

main();
