'use strict';
// 临时探针：打印五仓 detachedList / optionalSuspects，供扫尾剪枝判定
const path = require('path');
const { buildTree, importanceForensics } = require('./lib');
const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));

const REPOS = '/tmp/arch-orch/repos';
for (const name of ['changedetection.io', 'listmonk', 'uptime-kuma', 'memos', 'umami']) {
  const root = path.join(REPOS, name);
  const tree = buildTree(root);
  const inv = scan(root);
  const imp = importanceForensics(root, tree, inv.entrypoints);
  console.log('\n===== ' + name + ' =====');
  console.log('detachedList:');
  for (const d of (imp.detachedList || [])) console.log('  ' + JSON.stringify(d).slice(0, 160));
  console.log('optionalSuspects: ' + JSON.stringify((imp.optionalSuspects || []).slice(0, 20)).slice(0, 600));
}
