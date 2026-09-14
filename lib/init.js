'use strict';

const fs = require('fs');
const path = require('path');
const { KIT_FILES, COMPAT_KIT_FILES, KIT_DIR_CANDIDATES, DIAGRAM_FILES } = require('./kit');

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

function copyFile(from, to, preserveExisting) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.copyFileSync(from, to, preserveExisting ? fs.constants.COPYFILE_EXCL : 0);
    return true;
  } catch (err) {
    if (preserveExisting && err.code === 'EEXIST') return false;
    throw err;
  }
}

function initKit(repoRoot, destRel, opts) {
  const dest = path.join(path.resolve(repoRoot), destRel || 'architecture_viewer');
  const srcRoot = productRoot();
  const copied = [];
  const files = (opts && opts.compatSix) ? COMPAT_KIT_FILES : KIT_FILES;
  for (const rel of files) {
    const from = path.join(srcRoot, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, rel);
    if (copyFile(from, to, DIAGRAM_FILES.includes(rel))) copied.push(rel);
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
    '源码与编排文件，按 AGENT.md 覆写默认视图 block-diagram.md（静态结构总览）。',
    '不要默认一次生成六张图。类图仅围绕本次修改的类和邻居；C4 Context 需人工确认；',
    'C4 Container/Component 与无启动证据的 Deployment 不要作为默认交付。',
    '不要改 HTML 与 architecture.config.js。'
  ].join('\n');
}

module.exports = { productRoot, findKitDir, initKit, writeGenerated, agentPrompt };
