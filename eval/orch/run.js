'use strict';
/**
 * 兼容垫片：产品运行时已迁移至 lib/orch/run.js。
 * - require('./run')  → 重导出 lib/orch/run.js 的全部函数
 * - node eval/orch/run.js <args> → 转发到 lib/orch/run.js
 */
const path = require('path');

if (require.main === module) {
  // CLI 转发：eval/orch/run.js → lib/orch/run.js
  const { spawn } = require('child_process');
  const realRunner = path.join(__dirname, '..', '..', 'lib', 'orch', 'run.js');
  const child = spawn(process.execPath, [realRunner, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code) => process.exit(code || 0));
} else {
  module.exports = require('../../lib/orch/run');
}
