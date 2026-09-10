'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const {
  webviewCspContent,
  applyWebviewCsp,
  cspAllowsRemote
} = require('../src/webview-csp');
const { buildPreviewHtml, KIT_VIEW_FILES, resolveMermaidFile } = require('../src/webview-preview');

const root = path.join(__dirname, '..');
const SRC_DIR = path.join(root, 'src');

function srcFiles() {
  return fs.readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(SRC_DIR, f));
}

describe('webview CSP policy', () => {
  it('has no remote host or https:/http: scheme wildcard', () => {
    const content = webviewCspContent("'self'");
    assert.equal(cspAllowsRemote(content), false);
    assert.match(content, /default-src 'none'/);
    assert.match(content, /img-src 'self' data:/);
    assert.doesNotMatch(content, /cdn\.jsdelivr/);
    assert.doesNotMatch(content, /(?:^|[\s;])https?:(?:[\s;"']|$)/);
  });

  it('src/ webview files do not hardcode CDN or https: wildcards', () => {
    for (const file of srcFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(cspAllowsRemote(text), false, file);
      assert.doesNotMatch(text, /cdn\.jsdelivr|unpkg\.com/);
    }
  });

  it('session report CSP no longer allows img-src https:', () => {
    const html = applyWebviewCsp(
      '<!DOCTYPE html><html><head></head><body>report</body></html>',
      "'self'"
    );
    assert.match(html, /Content-Security-Policy/);
    const meta = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
    assert.equal(cspAllowsRemote(meta), false);
    assert.doesNotMatch(meta, /\bhttps:/);
  });
});

describe('webview Preview HTML assembly', () => {
  const html = buildPreviewHtml({
    kitDir: root,
    mermaidHref: '/vendor/mermaid.min.js',
    cspSource: "'self'"
  });

  it('inlines six view sources and local mermaid, no CDN', () => {
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /src="\/vendor\/mermaid\.min\.js"/);
    assert.match(html, /window\.__ARCH_INLINE_SOURCES__/);
    for (const f of KIT_VIEW_FILES) {
      assert.match(html, new RegExp(f.replace('.', '\\.')));
      assert.ok(html.includes(JSON.stringify(f).slice(1, -1)) || html.includes(`"${f}"`));
    }
    assert.doesNotMatch(html, /cdn\.jsdelivr|unpkg\.com/);
    assert.doesNotMatch(html, /src="https?:/);
    assert.equal(fs.existsSync(resolveMermaidFile(root, root)), true);
  });

  it('keeps tab switch, search, and export controls', () => {
    assert.match(html, /function switchTab\s*\(/);
    assert.match(html, /function exportPDF\s*\(/);
    assert.match(html, /onclick="exportPDF\(\)"/);
    assert.match(html, /class="tab-btn/);
    assert.match(html, /placeholder="搜索模块名称/);
    assert.match(html, /id="search-input-'\s*\+\s*tabId/);
  });
});

describe('offline Preview render (CSP + no remote)', () => {
  it('renders six views, search, and export with remote requests blocked', async (t) => {
    let chromium;
    try {
      ({ chromium } = require('playwright'));
    } catch {
      t.skip('playwright not installed');
      return;
    }

    const previewHtml = buildPreviewHtml({
      kitDir: root,
      mermaidHref: '/vendor/mermaid.min.js',
      cspSource: "'self'"
    });
    const mermaidBuf = fs.readFileSync(path.join(root, 'vendor', 'mermaid.min.js'));

    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(previewHtml);
        return;
      }
      if (url === '/vendor/mermaid.min.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(mermaidBuf);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      server.close();
      t.skip('playwright chromium not installed: ' + (e && e.message));
      return;
    }

    const remoteHits = [];
    try {
      const context = await browser.newContext();
      await context.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(origin)) return route.continue();
        remoteHits.push(u);
        return route.abort();
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));

      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await expectSvg(page, 'c4-context');

      const tabs = ['c4-context', 'c4-container', 'c4-component', 'block', 'class', 'deployment'];
      for (const tabId of tabs) {
        await page.evaluate((id) => window.switchTab(id), tabId);
        await expectSvg(page, tabId);
        const search = page.locator('#search-input-' + tabId);
        await search.waitFor({ state: 'visible', timeout: 15_000 });
        await search.fill('a');
        await search.fill('');
      }

      const exportBtn = page.locator('button.tool-pdf');
      assert.equal(await exportBtn.isEnabled(), true);
      assert.equal(await exportBtn.isVisible(), true);
      const exportOk = await page.evaluate(() => typeof window.exportPDF === 'function');
      assert.equal(exportOk, true);

      assert.deepEqual(remoteHits, []);
      assert.deepEqual(pageErrors, []);
    } finally {
      if (browser) await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

async function expectSvg(page, tabId) {
  const sel = `#tab-${tabId} svg`;
  await page.waitForFunction((selector) => {
    const el = document.querySelector(selector);
    return !!(el && el.getClientRects().length);
  }, sel, { timeout: 30_000 });
}
