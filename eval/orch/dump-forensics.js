'use strict';

// 确定性取证 dump：不调 LLM，输出五仓的 可选组件 / 旁路组件 / 通用锚点，
// 用于在不烧 token 的情况下迭代 importanceForensics + findAnchorsV2。
// 用法：node eval/orch/dump-forensics.js <repo1> [repo2 ...]

const path = require('path');
const { buildTree, importanceForensics, findAnchorsV2 } = require('./lib');

const repos = process.argv.slice(2);
for (const repo0 of repos) {
  const repo = path.resolve(repo0);
  const name = path.basename(repo);
  let scan = { entrypoints: [] };
  try { ({ scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'))); } catch { /* lib/scan 可用即可 */ }
  const inv = scan(repo);
  const tree = buildTree(repo);
  const imp = importanceForensics(repo, tree, inv.entrypoints);
  const anchors = findAnchorsV2(tree, imp);
  console.log(`\n========== ${name} ==========`);
  console.log(`import 边: ${imp.edges} | 入口: ${(inv.entrypoints || []).slice(0, 5).join(', ')}`);
  console.log(`可选组件: ${imp.optionalKw.join(', ') || '无'}`);
  console.log(`旁路组件: ${imp.detachedList.map((d) => `${d.path}(h${d.heat})`).join(', ') || '无'}`);
  console.log('锚点:');
  for (const a of anchors) {
    console.log(`  ${a.role.padEnd(9)} → ${a.layer.padEnd(9)} ${a.path}  [score=${a.score} heat=${a.imp.heat} reach=${a.imp.reachable} opt=${a.imp.optional}]`);
  }
}
