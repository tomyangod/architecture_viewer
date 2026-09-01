#!/usr/bin/env node
// 离线验证 deterministicSweep：对五仓已生成产物跑扫尾，输出 actions 并用 structureGates 复查
// 用法: node eval/orch/verify-sweep.js
const path = require('path');
const fs = require('fs');
const lib = require('./lib');
const { deterministicSweep, structureGates } = require('./run');

const REPOS = ['changedetection.io', 'listmonk', 'uptime-kuma', 'memos', 'umami'];
const repoBase = process.env.REPO_BASE || '/tmp/arch-orch/repos';
const outBase = process.env.OUT_BASE || '/tmp/arch-orch/out/orch4';

let fail = 0;
for (const name of REPOS) {
  const repo = path.join(repoBase, name);
  const mdPath = path.join(outBase, name, 'block-diagram.md');
  if (!fs.existsSync(mdPath)) { console.log(`== ${name}: 产物缺失，跳过`); continue; }
  const md = fs.readFileSync(mdPath, 'utf8');
  const tree = lib.buildTree(repo);
  const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));
  const inv = scan(repo);
  const importance = lib.importanceForensics(repo, tree, inv.entrypoints);
  const anchors = lib.findAnchorsV2(tree, importance);

  const selfTokens = [name, name.replace(/\.io$/, '')];
  const before = structureGates(md, anchors, importance, selfTokens);
  const res = deterministicSweep(md, anchors, selfTokens);
  const after = structureGates(res.md, anchors, importance, selfTokens);

  console.log(`\n===== ${name} =====`);
  console.log(`anchors: ${anchors.map((a) => a.role + ':' + a.path).join(' | ')}`);
  console.log('sweep actions:');
  (res.actions.length ? res.actions : ['（无动作）']).forEach((a) => console.log('  - ' + a));
  console.log(`structureGates: before=${before.length} after=${after.length}`);
  after.forEach((i) => console.log(`  [${i.severity}/${i.kind}] ${i.issue}`));
  if (after.some((i) => i.severity === 'high')) fail++;
  fs.writeFileSync(path.join(outBase, name, 'block-diagram.swept.md'), res.md);
}
console.log(`\n${fail ? '❌ 仍有 high 级结构问题：' + fail + ' 仓' : '✅ 五仓 sweep 后无 high 级结构问题'}`);
process.exit(fail ? 1 : 0);
