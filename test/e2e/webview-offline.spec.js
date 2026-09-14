'use strict';

const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildPreviewHtml } = require('../../src/webview-preview');
const { generateForRepo } = require('../../lib');

const root = path.join(__dirname, '../..');
const TABS = ['c4-context', 'c4-container', 'c4-component', 'block', 'class', 'deployment'];

test.describe('Webview Preview offline + CSP', () => {
  /** @type {import('http').Server} */
  let server;
  let origin;
  let generatedRoot;

  test.beforeAll(async () => {
    const previewHtml = buildPreviewHtml({
      kitDir: root,
      mermaidHref: '/vendor/mermaid.min.js',
      cspSource: "'self'"
    });
    generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-generated-preview-'));
    for (const [file, content] of Object.entries({
      'backend/app.py': 'from backend.models import Reading\nclass App:\n    reading: Reading\n',
      'backend/models.py': 'class Reading:\n    value: int\n',
      'tools/monitoring/monitor_daemon.py': 'from backend.app import App\nclass Monitor:\n    app: App\n',
      'frontend/panel.js': 'export class Panel {}\n'
    })) {
      const target = path.join(generatedRoot, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const kitDir = path.join(generatedRoot, 'architecture_viewer');
    const generated = generateForRepo(generatedRoot, 'architecture_viewer', { compatSix: true });
    expect(generated.protocol.ok).toBe(true);
    const generatedHtml = buildPreviewHtml({ kitDir, mermaidHref: '/vendor/mermaid.min.js', cspSource: "'self'" });
    const mermaidBuf = fs.readFileSync(path.join(root, 'vendor', 'mermaid.min.js'));
    server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(previewHtml);
        return;
      }
      if (url === '/generated') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generatedHtml);
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
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (generatedRoot) fs.rmSync(generatedRoot, { recursive: true, force: true });
  });

  for (const routePath of ['/', '/generated']) {
    test(`six views ${routePath} render with remote requests blocked; tab / search / export work`, async ({ browser }) => {
      const remoteHits = [];
      const context = await browser.newContext();
      await context.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(origin)) return route.continue();
        remoteHits.push(u);
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(origin + routePath, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#av-evidence-notice')).toContainText('Human review required');
      // Initial tab activation is deferred; wait for it before testing user navigation.
      await expect(page.locator('#tab-block svg').first()).toBeVisible({ timeout: 30_000 });

      for (const tabId of TABS) {
        await page.evaluate((id) => window.switchTab(id), tabId);
        await expect(page.locator(`#tab-${tabId} svg`).first()).toBeVisible({ timeout: 30_000 });
        const subtabs = page.locator(`#tab-${tabId} .sub-tab-btn`);
        for (let i = 0; i < await subtabs.count(); i++) {
          await subtabs.nth(i).click();
          await expect(page.locator(`#tab-${tabId} .diagram-section.active svg`)).toBeVisible({ timeout: 30_000 });
        }
        await expect(page.locator(`#search-input-${tabId}`)).toBeVisible({ timeout: 15_000 });
      }

      await expect(page.locator('button.tool-pdf')).toBeEnabled();
      expect(await page.evaluate(() => typeof window.exportPDF === 'function')).toBeTruthy();
      expect(remoteHits).toEqual([]);
      await context.close();
    });
  }
});
