#!/usr/bin/env node
'use strict';

// CI 入口：本仓 workflow dogfood 本地代码用。
// 用户仓库复制 architecture-diff.yml 后，直接用：
//   npx arch-viewer pr-comment <base-dir> <head-dir> --post
// 本脚本等价于 `arch-viewer pr-comment`，只是强制走仓库内代码而非已发布版本。
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
  console.error('Usage: node scripts/pr-comment.js <base-dir> <head-dir> [--post]');
  process.exit(args.length < 2 ? 2 : 0);
}

const r = spawnSync(
  process.execPath,
  [path.join(__dirname, '..', 'lib', 'cli.js'), 'pr-comment', ...args],
  { stdio: 'inherit' }
);
process.exit(r.status ?? 1);
