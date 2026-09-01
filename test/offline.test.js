const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

describe('offline mermaid bundle', () => {
  it('vendors mermaid and does not load CDN scripts', () => {
    const html = fs.readFileSync(path.join(root, 'architecture_visualized.html'), 'utf8');
    const ext = fs.readFileSync(path.join(root, 'src/extension.js'), 'utf8');
    assert.ok(fs.existsSync(path.join(root, 'vendor/mermaid.min.js')));
    assert.doesNotMatch(html, /cdn\.jsdelivr|unpkg\.com/);
    assert.doesNotMatch(ext, /cdn\.jsdelivr/);
    assert.match(html, /vendor\/mermaid\.min\.js/);
  });
});
