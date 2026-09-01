#!/usr/bin/env node
'use strict';

/**
 * Bake static share pages into web/public/samples/*
 * so the marketing site never needs live repo scanning.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VIEWER_HTML = path.join(ROOT, 'architecture_visualized.html');
const VIEWER_CONFIG = path.join(ROOT, 'architecture.config.js');
const DIAGRAM_FILES = [
  'c4-context.md',
  'c4-container.md',
  'c4-component.md',
  'block-diagram.md',
  'class-diagram.md',
  'deployment-ops.md'
];

function bake(sampleId, kitDir, title, meta) {
  const outDir = path.join(ROOT, 'web', 'public', 'samples', sampleId);
  fs.mkdirSync(outDir, { recursive: true });

  let html = fs.readFileSync(VIEWER_HTML, 'utf8');
  let configJs = fs.readFileSync(VIEWER_CONFIG, 'utf8');
  // Patch project title in USER_CONFIG for the baked page
  configJs = configJs.replace(
    /title:\s*'项目架构可视化全景'/,
    `title: ${JSON.stringify(title)}`
  );
  configJs = configJs.replace(
    /subtitle:\s*'[^']*'/,
    `subtitle: ${JSON.stringify(meta.subtitle || 'Architecture Viewer Showcase')}`
  );
  if (meta.defaultTab) {
    configJs = configJs.replace(
      /const USER_CONFIG = \{/,
      `const USER_CONFIG = {\n    embed: { defaultTab: ${JSON.stringify(meta.defaultTab)} },`
    );
  }

  const sources = {};
  for (const name of DIAGRAM_FILES) {
    const p = path.join(kitDir, name);
    if (fs.existsSync(p)) sources[name] = fs.readFileSync(p, 'utf8');
  }

  const banner = meta.banner
    ? `<div id="av-showcase-banner" style="position:sticky;top:0;z-index:9999;padding:10px 16px;background:${meta.banner.bg};color:${meta.banner.fg};font:14px/1.4 system-ui,sans-serif;border-bottom:1px solid rgba(0,0,0,.08);">${meta.banner.html}</div>`
    : '';

  const inject =
    `${banner}<script>window.__ARCH_INLINE_SOURCES__=${JSON.stringify(sources)};` +
    `document.title=${JSON.stringify(title)};</script>`;

  html = html.replace(
    '<script src="architecture.config.js"></script>',
    `<script>${configJs}</script>\n    ${inject}`
  );
  html = html.replace('src="vendor/mermaid.min.js"', 'src="/vendor/mermaid.min.js"');

  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify(
      {
        id: sampleId,
        title,
        subtitle: meta.subtitle || '',
        protocolOk: meta.protocolOk !== false,
        driftOk: meta.driftOk !== false,
        story: meta.story || '',
        checks: meta.checks || []
      },
      null,
      2
    )
  );
  console.log('baked /samples/' + sampleId + '/');
}

// --- Showcase: Coffee Shop (good path) ---
bake(
  'showcase',
  path.join(ROOT, 'examples', 'showcase-shop', 'architecture_viewer'),
  'Coffee Shop · 咖啡订单平台',
  {
    subtitle: '官方 Showcase · 六视图一次看懂下单链路',
    protocolOk: true,
    driftOk: true,
    story: '顾客下单 → API 落库/扣库存 → MQ → Worker 出杯通知',
    checks: ['协议 PASS', '漂移 0', 'compose 6 服务', '领域类 4 个'],
    banner: {
      bg: '#0f6e56',
      fg: '#f4fff9',
      html: '<strong>Showcase · Coffee Shop</strong>　先看「分层模块」Tab（彩色分层）　·　C4 更素，分层图更接近业务手绘'
    },
    defaultTab: 'block'
  }
);

// --- Drift fail educational sample ---
bake(
  'drift-fail',
  path.join(ROOT, 'eval', 'demo-drift'),
  '故意坏图 · 漂移红灯演示',
  {
    subtitle: 'Validate / CI 会拦截：未声明 Rel + 未填模板',
    protocolOk: false,
    driftOk: false,
    story: '演示「坏图进不了主干」——这才是付费理由',
    checks: ['协议 FAIL', 'Rel 未声明', '模板占位未清'],
    banner: {
      bg: '#9a4a12',
      fg: '#fff8f1',
      html: '<strong>漂移红灯演示</strong>　<code>arch-viewer check --filled</code> 退出码 ≠ 0　·　Rel(web, ghost_service) 未声明 · 模板占位未清'
    }
  }
);

console.log('done');
