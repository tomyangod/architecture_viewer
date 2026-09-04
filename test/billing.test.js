'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.ARCH_PRO_SECRET = process.env.ARCH_PRO_SECRET || 'test-secret-billing';
delete process.env.ARCH_PAY_AFDIAN_URL;
delete process.env.ARCH_PAY_WECHAT_URL;
delete process.env.ARCH_PAY_LEMON_URL;

const { paymentLinks, DEFAULTS } = require('../web/lib/billing');
const { handler } = require('../web/server');

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request(
        { hostname: '127.0.0.1', port, path: urlPath, method },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

describe('W05-02 billing links', () => {
  it('paymentLinks defaults include afdian / wechat / lemon', () => {
    const links = paymentLinks();
    assert.equal(links.afdian, DEFAULTS.afdian);
    assert.match(links.wechat, /billing\.md/);
    assert.match(links.lemon, /lemonsqueezy\.com/);
    assert.equal(links.priceCny, 29);
  });

  it('env overrides take effect', () => {
    process.env.ARCH_PAY_AFDIAN_URL = 'https://afdian.com/a/custom';
    process.env.ARCH_PAY_LEMON_URL = 'https://example.lemonsqueezy.com/buy/test';
    try {
      const links = paymentLinks();
      assert.equal(links.afdian, 'https://afdian.com/a/custom');
      assert.equal(links.lemon, 'https://example.lemonsqueezy.com/buy/test');
    } finally {
      delete process.env.ARCH_PAY_AFDIAN_URL;
      delete process.env.ARCH_PAY_LEMON_URL;
    }
  });

  it('GET /api/billing/links and pricing page expose clickable pay anchors', async () => {
    const api = await request('GET', '/api/billing/links');
    assert.equal(api.status, 200, api.body);
    const data = JSON.parse(api.body);
    assert.match(data.afdian, /^https?:\/\//);
    assert.match(data.wechat, /^https?:\/\//);
    assert.match(data.lemon, /^https?:\/\//);

    const page = await request('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /id="pay-afdian"/);
    assert.match(page.body, /id="pay-wechat"/);
    assert.match(page.body, /id="pay-lemon"/);
    assert.match(page.body, /afdian\.com/);
  });

  it('docs/billing.md records pay → verify → grant SOP', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'billing.md'), 'utf8');
    assert.match(md, /付款/);
    assert.match(md, /核验/);
    assert.match(md, /开通 Pro/);
    assert.match(md, /admin\/grant/);
    assert.match(md, /Lemon Squeezy/);
    assert.match(md, /爱发电/);
    assert.match(md, /微信/);
  });
});
