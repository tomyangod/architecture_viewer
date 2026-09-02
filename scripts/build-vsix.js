'use strict';

// vsce 不允许 .vscodeignore 与 package.json 的 "files" 字段共存；
// 而 "files" 是 npm 包（arch-viewer CLI）发布白名单，不能删。
// 本脚本：打包前临时移除 files 字段 → 调 vsce package → 无论成败恢复。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (!pkg.files) {
  console.error('package.json 中未找到 files 字段，无需本脚本');
  process.exit(1);
}

const savedFiles = pkg.files;
delete pkg.files;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const args = [
  'package',
  '--no-git-tag-version',
  '--baseContentUrl', 'https://gitee.com/heyangyan/architecture_viewer/raw/main/',
  '--baseImagesUrl', 'https://gitee.com/heyangyan/architecture_viewer/raw/main/',
  '-o', 'arch-viewer.vsix',
  ...process.argv.slice(2)
];

try {
  const r = spawnSync(
    process.platform === 'win32' ? 'vsce.cmd' : 'vsce',
    args,
    { stdio: 'inherit', cwd: root }
  );
  // 不使用 process.exit()——它会跳过 finally 导致 files 字段丢失
  process.exitCode = r.status ?? 1;
} finally {
  const restored = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  restored.files = savedFiles;
  fs.writeFileSync(pkgPath, JSON.stringify(restored, null, 2) + '\n');
}
