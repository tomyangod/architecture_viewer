'use strict';

const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildPreviewHtml } = require('../../src/webview-preview');

const root = path.join(__dirname, '../..');
const TABS = ['c4-context', 'c4-container', 'c4-component', 'block', 'class', 'deployment'];

test.describe('Webview Preview offline + CSP', () => {
  /** @type {import('http').Server} */
  let server;
  let origin;

  test.beforeAll(async () => {
    const previewHtml = buildPreviewHtml({
      kitDir: root,
      mermaidHref: '/vendor/mermaid.min.js',
      cspSource: "'self'"
    });
    const mermaidBuf = fs.readFileSync(path.join(root, 'vendor', 'mermaid.min.js'));
    server = http.createServer((req, res) => {
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
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test('six views render with remote requests blocked; tab / search / export work', async ({ browser }) => {
    const remoteHits = [];
    const context = await browser.newContext();
    await context.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return route.continue();
      remoteHits.push(u);
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });

    for (const tabId of TABS) {
      await page.evaluate((id) => window.switchTab(id), tabId);
      await expect(page.locator(`#tab-${tabId} svg`).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`#search-input-${tabId}`)).toBeVisible({ timeout: 15_000 });
    }

    await expect(page.locator('button.tool-pdf')).toBeEnabled();
    expect(await page.evaluate(() => typeof window.exportPDF === 'function')).toBeTruthy();
    expect(remoteHits).toEqual([]);
    await context.close();
  });
});
