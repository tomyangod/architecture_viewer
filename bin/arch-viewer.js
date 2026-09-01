#!/usr/bin/env node
'use strict';

// CLI 入口 shim：lib/cli.js 内部用 `require.main === module` 守卫自执行，
// 从本 shim require 时守卫不成立，必须显式调用导出的 main()。
require('../lib/cli.js')
  .main(process.argv.slice(2))
  .then(
    (code) => process.exit(code || 0),
    (err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    }
  );
