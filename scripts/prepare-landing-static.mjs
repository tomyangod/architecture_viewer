#!/usr/bin/env node
'use strict';

/** 把落地页打成可丢给 GitHub/Gitee Pages 的静态目录（含 demo 视频）。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'web', 'public');
const OUT = path.join(ROOT, 'dist', 'landing');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const a = path.join(from, ent.name);
    const b = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SRC, OUT);

const demoFiles = ['demo.mp4', 'demo.zh.vtt', 'demo.en.vtt', 'demo.zh.srt', 'demo.en.srt'];
for (const name of demoFiles) {
  const src = path.join(ROOT, 'docs', name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, name));
}

// GitHub/Gitee Pages 常挂在 /repo/ 子路径；落地页里的 /styles.css 会打到站点根。
// 静态包改成相对路径，项目页也能加载样式和 demo 视频。
const indexPath = path.join(OUT, 'index.html');
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8').replace(/(href|src)="\/(?!\/)/g, '$1="./');
  fs.writeFileSync(indexPath, html);
}

console.log('Landing static → ' + OUT);
