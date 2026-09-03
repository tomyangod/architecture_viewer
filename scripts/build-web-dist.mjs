#!/usr/bin/env node

/**
 * W02-02 网页版离线包构建脚本
 *
 * 把 web/ 打成自包含 zip：替换 CDN 字体为系统字体，
 * 内嵌 viewer 模板，解压后 node server.js 即可离线运行。
 *
 * 用法： node scripts/build-web-dist.mjs [--out dist/arch-viewer-web-offline.zip]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'arch-viewer-web-offline.zip');

const outArg = process.argv.find((a) => a.startsWith('--out='));
const outPath = outArg ? outArg.slice(6) : DEFAULT_OUT;

// 1. 准备临时目录
const tmpDir = path.join(ROOT, '.tmp-web-dist');
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

// 2. 递归复制 web/ 到临时目录（排除 pro/ 后端逻辑和 .av）
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.av' || entry.name === 'node_modules') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(WEB_DIR, tmpDir);

// 3. 补丁 index.html：移除 Google Fonts CDN，用系统字体
const indexHtml = path.join(tmpDir, 'public', 'index.html');
if (fs.existsSync(indexHtml)) {
  let html = fs.readFileSync(indexHtml, 'utf8');
  // 删除 preconnect 和 Google Fonts <link>
  html = html.replace(/\s*<link rel="preconnect"[^>]*\/>/g, '');
  html = html.replace(/\s*<link rel="preconnect"[^>]*\/>/g, '');
  html = html.replace(/\s*<link href="https:\/\/fonts\.googleapis[^>]*\/>/g, '');
  // 在 <head> 末尾加系统字体 fallback CSS
  const fallbackCss = `<style>
      body, button, input, select, textarea {
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", sans-serif;
      }
      h1, h2, h3, h4, h5, h6, .brand, .nav a, .hero h1, .hero h2 {
        font-family: "Fraunces", Georgia, "Times New Roman", "Noto Serif SC", "Songti SC", serif;
      }
    </style>`;
  html = html.replace('</head>', `${fallbackCss}\n</head>`);
  fs.writeFileSync(indexHtml, html);
}

// 4. 补丁 local-pro.html 等其他 HTML 文件（移除 CDN 字体）
const otherHtmls = fs.readdirSync(path.join(tmpDir, 'public'))
  .filter((f) => f.endsWith('.html') && f !== 'index.html');
for (const f of otherHtmls) {
  const fp = path.join(tmpDir, 'public', f);
  let html = fs.readFileSync(fp, 'utf8');
  html = html.replace(/\s*<link rel="preconnect"[^>]*\/>/g, '');
  html = html.replace(/\s*<link href="https:\/\/fonts\.googleapis[^>]*\/>/g, '');
  fs.writeFileSync(fp, html);
}

// 5. 添加离线 README
fs.writeFileSync(path.join(tmpDir, 'OFFLINE-README.txt'), [
  'Architecture Viewer — 网页版离线包',
  '',
  '用法：',
  '  1. 解压这个 zip 到任意目录',
  '  2. cd 到解压后的目录',
  '  3. node server.js',
  '  4. 浏览器打开 http://127.0.0.1:3847',
  '',
  '不需要联网。字体已替换为系统字体。',
  ''
].join('\n'));

// 6. 打 zip
const outDir = path.dirname(outPath);
fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

const zipName = path.basename(outPath);
execSync(`cd "${tmpDir}" && zip -r -X "${path.resolve(outPath)}" . -x "*.DS_Store" -x "OFFLINE-README.txt"`, {
  stdio: 'pipe'
});
// 把 OFFLINE-README.txt 放到 zip 根部
execSync(`cd "${tmpDir}" && zip "${path.resolve(outPath)}" OFFLINE-README.txt`, {
  stdio: 'pipe'
});

// 7. 清理临时目录
fs.rmSync(tmpDir, { recursive: true });

// 8. 统计输出
const stats = fs.statSync(outPath);
const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
console.log(`Web offline zip: ${outPath} (${sizeMB} MB)`);
