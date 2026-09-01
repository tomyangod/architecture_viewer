#!/usr/bin/env node
'use strict';
// 聚合 blind-edge-u1-p1shape 的多轮结果：按仓、按轮、总体，输出 deliverable Δ 与维度均值对比
const fs = require('fs');
const path = require('path');
const DIMS = ['path_truth', 'layer_semantics', 'edge_correctness', 'business_naming', 'density_readability', 'spec_compliance', 'deliverable'];
const BLIND = '/tmp/arch-orch/out/blind-edge-u1-p1shape';
const ROUNDS = [1, 2, 3];

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

const allResults = [];
const perRepoPerRound = {}; // repo -> round -> {usage1: score, orch4: score}
const perRepo = {};
for (const r of ROUNDS) {
  const p = path.join(BLIND, 'round-' + r + '.json');
  if (!fs.existsSync(p)) continue;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const row of data.results) {
    if (!perRepoPerRound[row.repo]) perRepoPerRound[row.repo] = {};
    const u1 = (row.scores.find((s) => row.key[s.id] === 'usage1') || {});
    const o4 = (row.scores.find((s) => row.key[s.id] === 'orch4') || {});
    perRepoPerRound[row.repo][r] = {
      usage1: Object.fromEntries(DIMS.map((d) => [d, +u1[d] || 0])),
      orch4:  Object.fromEntries(DIMS.map((d) => [d, +o4[d] || 0])),
      better: row.better ? row.key[row.better] : row.better,
      comments: row.comments
    };
    if (!perRepo[row.repo]) perRepo[row.repo] = { usage1: {}, orch4: {}, betterCount: { orch4: 0, usage1: 0, tie: 0 } };
    for (const v of ['usage1', 'orch4']) for (const d of DIMS) {
      perRepo[row.repo][v][d] = perRepo[row.repo][v][d] || [];
      perRepo[row.repo][v][d].push(perRepoPerRound[row.repo][r][v][d]);
    }
    const b = perRepoPerRound[row.repo][r].better;
    if (b === 'orch4' || b === 'usage1' || b === 'tie') perRepo[row.repo].betterCount[b]++;
  }
}

console.log('========== edge 四仓盲评 三轮聚合 ==========\n');

// 总体
const total = { usage1: Object.fromEntries(DIMS.map((d) => [d, []])),
  orch4:  Object.fromEntries(DIMS.map((d) => [d, []])),
  wins: { orch4: 0, usage1: 0, tie: 0 } };
for (const repo in perRepo) {
  for (const v of ['usage1', 'orch4']) for (const d of DIMS)
    total[v][d].push(...perRepo[repo][v][d]);
  total.wins.orch4  += perRepo[repo].betterCount.orch4;
  total.wins.usage1 += perRepo[repo].betterCount.usage1;
  total.wins.tie    += perRepo[repo].betterCount.tie;
}

function pad(s, n) { return String(s).padEnd(n); }

console.log('总体（' + total.wins.usage1 + '仓次 usage1 胜 / ' + total.wins.orch4 + '仓次 orch4 胜 / ' + total.wins.tie + '仓次 平）：');
console.log(pad('维度', 20) + ' | ' + pad('usage1', 8) + ' | ' + pad('orch4', 8) + ' | ' + pad('Δ(o4-u1)', 10));
for (const d of DIMS) {
  const u = mean(total.usage1[d]).toFixed(2);
  const o = mean(total.orch4[d]).toFixed(2);
  const gap = (mean(total.orch4[d]) - mean(total.usage1[d]));
  console.log(pad(d, 20) + ' | ' + pad(u, 8) + ' | ' + pad(o, 8) + ' | ' +
    pad((gap >= 0 ? '+' : '') + gap.toFixed(2), 10));
}
const dO4 = mean(total.orch4.deliverable);
const dU1 = mean(total.usage1.deliverable);
console.log('\n综合 deliverable orch4=' + dO4.toFixed(2) + '  usage1=' + dU1.toFixed(2) +
  '  Δ(orch4-usage1)=' + ((dO4 - dU1) >= 0 ? '+' : '') + (dO4 - dU1).toFixed(2));

console.log('\n========== 按仓库（三轮均值） ==========');
const heads = ['repo', 'u1-dl', 'o4-dl', 'Δdl', 'u1-edge', 'o4-edge', 'Δedge', '胜局(o4/u1/tie)'];
console.log(heads.map((h) => pad(h, 18)).join(' '));
for (const repo in perRepo) {
  const u_dl  = mean(perRepo[repo].usage1.deliverable);
  const o_dl  = mean(perRepo[repo].orch4.deliverable);
  const u_edge = mean(perRepo[repo].usage1.edge_correctness);
  const o_edge = mean(perRepo[repo].orch4.edge_correctness);
  const w = perRepo[repo].betterCount;
  console.log([
    repo,
    u_dl.toFixed(2), o_dl.toFixed(2), ((o_dl - u_dl) >= 0 ? '+' : '') + (o_dl - u_dl).toFixed(2),
    u_edge.toFixed(2), o_edge.toFixed(2), ((o_edge - u_edge) >= 0 ? '+' : '') + (o_edge - u_edge).toFixed(2),
    w.orch4 + '/' + w.usage1 + '/' + w.tie
  ].map((h) => pad(h, 18)).join(' '));
}

console.log('\n========== 按轮 ==========');
const roundAgg = { usage1: [], orch4: [] };
for (const r of ROUNDS) {
  const ds_u1 = [], ds_o4 = [];
  for (const repo in perRepoPerRound) if (perRepoPerRound[repo][r]) {
    ds_u1.push(perRepoPerRound[repo][r].usage1.deliverable);
    ds_o4.push(perRepoPerRound[repo][r].orch4.deliverable);
  }
  console.log('round-' + r + ' deliverable: usage1=' + mean(ds_u1).toFixed(2) +
    ' orch4=' + mean(ds_o4).toFixed(2) +
    ' Δ=' + ((mean(ds_o4) - mean(ds_u1)) >= 0 ? '+' : '') + (mean(ds_o4) - mean(ds_u1)).toFixed(2));
}

const out = {
  generated_at: new Date().toISOString(),
  rounds: ROUNDS,
  total: {
    wins: total.wins,
    meanDims: { usage1: Object.fromEntries(DIMS.map((d) => [d, mean(total.usage1[d])])),
                orch4:  Object.fromEntries(DIMS.map((d) => [d, mean(total.orch4[d])])) },
    deliverableDelta: dO4 - dU1
  },
  perRepo: Object.fromEntries(Object.entries(perRepo).map(([repo, v]) => [repo, {
    betterCount: v.betterCount,
    meanDims: { usage1: Object.fromEntries(DIMS.map((d) => [d, mean(v.usage1[d])])),
                orch4:  Object.fromEntries(DIMS.map((d) => [d, mean(v.orch4[d])])) },
    deliverableDelta: mean(v.orch4.deliverable) - mean(v.usage1.deliverable)
  }]))
};
const outPath = '/tmp/arch-orch/out/blind-edge-u1-p1shape/summary.json';
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('\nSummary JSON: ' + outPath);
