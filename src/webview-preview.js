'use strict';

const fs = require('fs');
const path = require('path');
const { applyWebviewCsp } = require('./webview-csp');

const KIT_VIEW_FILES = [
  'c4-context.md',
  'c4-container.md',
  'c4-component.md',
  'block-diagram.md',
  'class-diagram.md',
  'deployment-ops.md'
];

function resolveMermaidFile(kitDir, extensionPath) {
  const mermaidKit = path.join(kitDir, 'vendor', 'mermaid.min.js');
  if (fs.existsSync(mermaidKit)) return mermaidKit;
  const mermaidExt = path.join(extensionPath || '', 'vendor', 'mermaid.min.js');
  if (fs.existsSync(mermaidExt)) return mermaidExt;
  throw new Error('vendor/mermaid.min.js not found (kit or extension)');
}

function readKitSources(kitDir) {
  const sources = {};
  for (const f of KIT_VIEW_FILES) {
    const p = path.join(kitDir, f);
    if (fs.existsSync(p)) sources[f] = fs.readFileSync(p, 'utf8');
  }
  return sources;
}

/**
 * Assemble the six-view Preview HTML for a VS Code webview (or a local CSP check).
 * mermaidHref must already be a webview / same-origin URL — never a CDN.
 */
function buildPreviewHtml({ kitDir, mermaidHref, cspSource }) {
  if (!kitDir) throw new Error('buildPreviewHtml: kitDir required');
  if (!mermaidHref) throw new Error('buildPreviewHtml: mermaidHref required');
  const htmlPath = path.join(kitDir, 'architecture_visualized.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const configPath = path.join(kitDir, 'architecture.config.js');
  const configJs = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const sources = readKitSources(kitDir);
  html = applyWebviewCsp(html, cspSource);
  html = html.replace('src="vendor/mermaid.min.js"', 'src="' + mermaidHref + '"');
  const inject = `<script>window.__ARCH_INLINE_SOURCES__ = ${JSON.stringify(sources)};</script>`;
  if (html.includes('<script src="architecture.config.js"></script>')) {
    html = html.replace(
      '<script src="architecture.config.js"></script>',
      `<script>${configJs}</script>\n    ${inject}`
    );
  } else {
    html = html.replace('</head>', `${inject}\n</head>`);
  }
  return html;
}

module.exports = {
  KIT_VIEW_FILES,
  resolveMermaidFile,
  readKitSources,
  buildPreviewHtml
};
