'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.ARCH_PRO_SECRET = process.env.ARCH_PRO_SECRET || 'test-secret-billing';
process.env.ARCH_PRO_DATA = process.env.ARCH_PRO_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'av-billing-'));
delete process.env.ARCH_PAY_AFDIAN_URL;
delete process.env.ARCH_PAY_WECHAT_URL;
delete process.env.ARCH_PAY_LEMON_URL;

const { paymentLinks, DEFAULTS } = require('../web/lib/billing');
const { handler } = require('../web/server');

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : '';
      const headers = payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {};
      const req = http.request(
        { hostname: '127.0.0.1', port, path: urlPath, method, headers },
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
      if (payload) req.write(payload);
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

describe('W11-01 Team yearly per-repo', () => {
  it('pricing page and COMMERCIAL.md list ¥999 / 年 / 仓库', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'index.html'), 'utf8');
    const commercial = fs.readFileSync(path.join(__dirname, '..', 'COMMERCIAL.md'), 'utf8');
    assert.match(html, /999/);
    assert.match(html, /年\/仓库|年 \/ 仓库/);
    assert.match(html, /id="team-order"/);
    assert.match(commercial, /999/);
    assert.match(commercial, /年 \/ 仓库/);
  });

  it('POST /api/billing/team-order creates sandbox grant for registered email', async () => {
    const email = 'team-' + Date.now() + '@example.com';
    const signup = await request('POST', '/api/pro/signup', { email, password: 'password1' });
    assert.equal(signup.status, 200, signup.body);
    const order = await request('POST', '/api/billing/team-order', {
      email,
      repoUrl: 'https://gitee.com/org/demo-repo',
      channel: 'lemon'
    });
    assert.equal(order.status, 200, order.body);
    const d = JSON.parse(order.body);
    assert.equal(d.ok, true);
    assert.equal(d.priceCny, 999);
    assert.equal(d.granted, true);
    assert.equal(d.status, 'sandbox-granted');
    assert.match(d.checkoutUrl, /http/);
    assert.ok(d.features.includes('ci_hosted'));
  });

  it('rejects invalid team order payload', async () => {
    const r = await request('POST', '/api/billing/team-order', { email: 'nope', repoUrl: 'not-a-url' });
    assert.equal(r.status, 400);
  });
});

describe('W09-02 support + invoice', () => {
  it('docs exist with FAQ ≥ 10 and landing footer links', () => {
    const support = fs.readFileSync(path.join(__dirname, '..', 'docs', 'support.md'), 'utf8');
    const invoice = fs.readFileSync(path.join(__dirname, '..', 'docs', 'invoice.md'), 'utf8');
    const faq = support.match(/^\d+\.\s/gm) || [];
    assert.ok(faq.length >= 10, 'FAQ count ' + faq.length);
    assert.match(support, /安装/);
    assert.match(support, /登录/);
    assert.match(support, /离线/);
    assert.match(invoice, /纳税人识别号|税号/);
    assert.match(invoice, /plan":"team"/);
  });

  it('landing footer reaches support.md and invoice.md', async () => {
    const page = await request('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /docs\/support\.md/);
    assert.match(page.body, /docs\/invoice\.md/);
  });
});

describe('W12-01 team on-prem quote', () => {
  it('team-onprem.md has tiers, deliverables, SLA', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'docs', 'team-onprem.md'), 'utf8');
    assert.match(text, /19,?999/);
    assert.match(text, /交付物/);
    assert.match(text, /SLA/);
    assert.match(text, /docker compose/i);
  });

  it('landing Team card links on-prem quote', async () => {
    const page = await request('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /team-onprem\.md/);
  });
});
