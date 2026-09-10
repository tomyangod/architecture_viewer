'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'architecture_visualized.html'),
  'utf8'
);

describe('viewer zoom / fullscreen 作用域', () => {
  it('缩放只 scale #inner（mermaid），子图标题条在 canvas 下、inner 外', () => {
    assert.match(html, /canvas\.insertBefore\(tabBar, inner\)/);
    assert.match(html, /#canvas-' \+ tabId \+ ' > \.sub-tab-bar/);
    assert.doesNotMatch(html, /inner\.appendChild\(tabBar\)/);
    assert.match(html, /inner\.style\.transform = 'scale\(' \+ z \+ '\)'/);
    assert.match(html, /硬边界：缩放只 scale #inner-/);
    assert.match(html, /const ZOOM_MAX = 4;/);
  });

  it('全屏只 requestFullscreen(diagram-canvas)，不含卡片标题', () => {
    assert.match(html, /\.diagram-canvas:fullscreen/);
    assert.match(html, /ensureCanvasFsControls/);
    assert.match(html, /canvas\.requestFullscreen|req\.call\(canvas\)/);
    assert.doesNotMatch(html, /btn\.closest\('\.diagram-card'\)/);
    assert.doesNotMatch(html, /\.diagram-card:fullscreen/);
  });

  it('加载期清洗嵌套 subgraph / 圆柱空格（与 flowchart-sanitize 同口径）', () => {
    assert.match(html, /function sanitizeFlowchartCode/);
    assert.match(html, /pre\.textContent = sanitizeFlowchartCode/);
  });
});
