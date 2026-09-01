'use strict';

const fs = require('fs');
const path = require('path');
const { KIT_FILES, KIT_DIR_CANDIDATES } = require('./kit');

function productRoot() {
  return path.resolve(__dirname, '..');
}

function findKitDir(repoRoot) {
  const root = path.resolve(repoRoot);
  for (const rel of KIT_DIR_CANDIDATES) {
    const p = path.join(root, rel);
    if (fs.existsSync(path.join(p, 'architecture_visualized.html'))) return p;
  }
  if (fs.existsSync(path.join(root, 'architecture_visualized.html'))) return root;
  return null;
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function initKit(repoRoot, destRel) {
  const dest = path.join(path.resolve(repoRoot), destRel || 'architecture_viewer');
  const srcRoot = productRoot();
  const copied = [];
  for (const rel of KIT_FILES) {
    const from = path.join(srcRoot, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, rel);
    copyFile(from, to);
    copied.push(rel);
  }
  return { dest, copied };
}

function writeGenerated(kitDir, files) {
  fs.mkdirSync(kitDir, { recursive: true });
  const written = [];
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(kitDir, name), body.endsWith('\n') ? body : body + '\n', 'utf8');
    written.push(name);
  }
  return written;
}

function agentPrompt(repoRoot, kitRel) {
  const rel = kitRel || 'architecture_viewer';
  return [
    `@${rel}/AGENT.md 是生成器规范。请扫描仓库根（${repoRoot}）的`,
    '源码、package.json / docker-compose.yml / configs / k8s，按 AGENT.md 要求',
    `覆写 ${rel} 下 6 个 .md 文件。每张图先给出 Mermaid 草稿，确认后再写盘。`,
    '从 c4-container.md 开始，最后做 c4-context.md。不要改 HTML 与 architecture.config.js。'
  ].join('\n');
}

module.exports = { productRoot, findKitDir, initKit, writeGenerated, agentPrompt };
