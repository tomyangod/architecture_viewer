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

  it('docs/commercial/billing.md records pay → verify → grant SOP', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commercial', 'billing.md'), 'utf8');
    assert.match(md, /付款/);
    assert.match(md, /核验/);
    assert.match(md, /开通 Pro/);
    assert.match(md, /admin\/grant/);
    assert.match(md, /Lemon Squeezy/);
    assert.match(md, /爱发电/);
    assert.match(md, /微信/);
  });
});

describe('W11-01 Team pricing copy', () => {
  it('pricing page and COMMERCIAL.md list Team as ¥99 / 人 / 月 with manual-application wording', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'index.html'), 'utf8');
    const account = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'account.html'), 'utf8');
    const commercial = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commercial', 'COMMERCIAL.md'), 'utf8');
    assert.match(html, /¥99/);
    assert.match(html, /人\/月|人 \/ 月/);
    assert.match(html, /id="team-apply"/);
    assert.match(html, /人工/);
    assert.match(account, /id="team-apply-form"/);
    assert.match(commercial, /¥99/);
    assert.match(commercial, /人 \/ 月/);
  });

  it('POST /api/billing/team-application records intent without order, price, or grant', async () => {
    const email = 'team-apply-' + Date.now() + '@example.com';
    const r = await request('POST', '/api/billing/team-application', {
      email,
      repoUrl: 'https://gitee.com/org/demo-repo',
      channel: 'landing'
    });
    assert.equal(r.status, 200, r.body);
    const d = JSON.parse(r.body);
    assert.equal(d.ok, true);
    assert.equal(d.status, 'pending');
    assert.equal(d.mode, 'manual-application');
    assert.ok(d.applicationId);
    assert.equal(d.granted, undefined);
    assert.equal(d.priceCny, undefined);
    assert.match(d.message, /人工/);
  });

  it('rejects invalid team application payload', async () => {
    const r = await request('POST', '/api/billing/team-application', { email: 'nope', repoUrl: 'not-a-url' });
    assert.equal(r.status, 400);
  });

  it('accepts team application without repoUrl; validates format only when provided', async () => {
    const email = 'team-norepo-' + Date.now() + '@example.com';
    const ok = await request('POST', '/api/billing/team-application', {
      email,
      channel: 'landing'
    });
    assert.equal(ok.status, 200, ok.body);
    const d = JSON.parse(ok.body);
    assert.equal(d.ok, true);
    assert.equal(d.mode, 'manual-application');

    const empty = await request('POST', '/api/billing/team-application', {
      email: 'team-empty-' + Date.now() + '@example.com',
      repoUrl: '   ',
      channel: 'landing'
    });
    assert.equal(empty.status, 200, empty.body);

    const bad = await request('POST', '/api/billing/team-application', {
      email: 'team-badurl-' + Date.now() + '@example.com',
      repoUrl: 'not-a-url'
    });
    assert.equal(bad.status, 400);
  });

  it('legacy /api/billing/team-order route is gone (no self-serve ¥999 product)', async () => {
    const r = await request('POST', '/api/billing/team-order', {
      email: 'x@example.com',
      repoUrl: 'https://gitee.com/org/x'
    });
    assert.notEqual(r.status, 200);
  });
});

describe('W09-02 support + invoice', () => {
  it('docs exist with FAQ ≥ 10 and landing footer links', () => {
    const support = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commercial', 'support.md'), 'utf8');
    const invoice = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commercial', 'invoice.md'), 'utf8');
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
    assert.match(page.body, /docs\/commercial\/support\.md/);
    assert.match(page.body, /docs\/commercial\/invoice\.md/);
  });
});

describe('W12-01 team on-prem quote', () => {
  it('team-onprem.md has tiers, deliverables, SLA', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commercial', 'team-onprem.md'), 'utf8');
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

describe('GTM diagnostic + pricing reversal', () => {
  it('diagnostic-service.md is a sendable close page with the four deliverables and WeChat SOP', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commercial', 'diagnostic-service.md'), 'utf8');
    assert.match(md, /扫描报告/);
    assert.match(md, /增量 diff/);
    assert.match(md, /修复优先级/);
    assert.match(md, /45\s*分钟/);
    assert.match(md, /¥999/);
    assert.match(md, /¥1,?999/);
    assert.match(md, /2026-09-30/);
    assert.match(md, /零上传/);
    assert.match(md, /退款/);
    assert.match(md, /工具本身免费|工具免费/);
    assert.match(md, /billing\.md/);
    assert.match(md, /AV-Diagnostic/);
  });

  it('landing features diagnostic first with pay-wechat, then Team ¥4,999, keeps per-seat and Pro convenience price', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'index.html'), 'utf8');
    const featured = html.match(/<article class="featured">[\s\S]*?<\/article>/);
    assert.ok(featured, 'featured diagnostic card');
    assert.match(featured[0], /AI 改码架构体检/);
    assert.match(featured[0], /¥999/);
    assert.match(featured[0], /id="pay-wechat"/);
    const diagIdx = html.indexOf('AI 改码架构体检');
    const teamIdx = html.indexOf('id="team-apply"');
    assert.ok(diagIdx > 0 && teamIdx > diagIdx, 'diagnostic card before team form');
    assert.match(html, /¥4,999/);
    assert.match(html, /¥99/);
    assert.match(html, /人\/月|人 \/ 月/);
    assert.match(html, /team-onprem\.md/);
    assert.match(html, /¥199/);
    assert.match(html, /id="pay-afdian"/);
    assert.match(html, /id="pay-lemon"/);
  });
});
