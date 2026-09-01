'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-'));
process.env.ARCH_PRO_DATA = dataDir;
process.env.ARCH_PRO_SECRET = 'test-secret-pro';
process.env.ARCH_PRO_LICENSE_SECRET = 'test-secret-pro';
process.env.ARCH_PRO_ADMIN_TOKEN = 'admin-test-token';
process.env.ARCH_PRO_FIXTURE = '1';
process.env.NODE_ENV = 'test';
process.env.ARCH_PUBLIC_URL = 'http://127.0.0.1:3847';

const { isActive, trialUntilFrom } = require('../web/lib/pro/entitlement');
const { formatComment } = require('../web/lib/pro/comment');
const { parseWebhook, parseRepoUrl } = require('../web/lib/pro/providers');
const { runHostedCheck } = require('../web/lib/pro/host-drift');
const billing = require('../web/lib/pro/billing');
const { handler } = require('../web/server');

const ROOT = path.join(__dirname, '..');

function request(method, urlPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const extra = body && body.__headers ? body.__headers : null;
    const payloadObj = body ? Object.assign({}, body) : null;
    if (payloadObj) delete payloadObj.__headers;
    const payload = payloadObj ? JSON.stringify(payloadObj) : '';
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const headers = {};
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (cookie) headers.Cookie = cookie;
      if (extra) Object.assign(headers, extra);
      const req = http.request(
        { hostname: '127.0.0.1', port, path: urlPath, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            const setCookie = res.headers['set-cookie'] && res.headers['set-cookie'][0];
            const session =
              setCookie && setCookie.match(/av_session=([^;]+)/) ? decodeURIComponent(RegExp.$1) : null;
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
              cookie: session ? 'av_session=' + session : cookie || '',
              session
            });
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

describe('Pro entitlement & comments', () => {
  it('trial is active for 7 days', () => {
    const created = new Date(Date.now() - 2 * 864e5).toISOString();
    const user = { trialUntil: trialUntilFrom(created), plan: 'trial' };
    assert.equal(isActive(user).ok, true);
    assert.equal(isActive(user).reason, 'trial');
  });

  it('expired trial is not active', () => {
    const user = { plan: 'trial', trialUntil: new Date(Date.now() - 1000).toISOString() };
    assert.equal(isActive(user).ok, false);
  });

  it('formats a red comment for missing kit', () => {
    const md = formatComment({ ok: false, kit: false, repo: 'a/b', pr: 3 });
    assert.match(md, /红灯/);
    assert.match(md, /arch-viewer init/);
    assert.match(md, /av-drift-bot/);
  });

  it('parses gitee and github repo URLs', () => {
    const g = parseRepoUrl('https://gitee.com/heyangyan/architecture_viewer.git');
    assert.equal(g.provider, 'gitee');
    assert.equal(g.owner, 'heyangyan');
    const gh = parseRepoUrl('https://github.com/org/app');
    assert.equal(gh.provider, 'github');
    assert.equal(gh.repo, 'app');
  });

  it('parses GitHub pull_request webhook', () => {
    const raw = '{"action":"opened"}';
    const secret = 'abc';
    const sig =
      'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const job = parseWebhook(
      { 'x-github-event': 'pull_request', 'x-hub-signature-256': sig },
      {
        action: 'opened',
        pull_request: { number: 9, title: 'x', head: { sha: 'fff', ref: 'feat', repo: { clone_url: 'https://github.com/o/r.git' } } },
        repository: { full_name: 'o/r', clone_url: 'https://github.com/o/r.git' }
      },
      raw,
      secret
    );
    assert.equal(job.skip, false);
    assert.equal(job.pr, 9);
    assert.equal(job.provider, 'github');
  });
});

describe('hosted check fixtures', () => {
  it('demo-drift is a red light', () => {
    const r = runHostedCheck(path.join(ROOT, 'eval/demo-drift'), { repoLabel: 'demo/drift', pr: 1 });
    assert.equal(r.ok, false);
    assert.match(r.markdown, /红灯/);
  });

  it('showcase-shop is a green light', () => {
    const r = runHostedCheck(path.join(ROOT, 'examples/showcase-shop'), { repoLabel: 'demo/shop', pr: 2 });
    assert.equal(r.ok, true);
    assert.match(r.markdown, /绿灯/);
  });
});

describe('Pro HTTP account + webhook', () => {
  let cookie = '';
  let repoId = '';
  let secret = '';

  before(async () => {
    const r = await request('POST', '/api/pro/signup', {
      email: 'seed@example.com',
      password: 'password1'
    });
    assert.equal(r.status, 200, r.body);
    cookie = r.cookie;
  });

  it('rejects duplicate signup', async () => {
    const r = await request('POST', '/api/pro/signup', {
      email: 'seed@example.com',
      password: 'password1'
    });
    assert.equal(r.status, 409);
  });

  it('me returns trial user', async () => {
    const r = await request('GET', '/api/pro/me', null, cookie);
    assert.equal(r.status, 200);
    const d = JSON.parse(r.body);
    assert.equal(d.user.active, true);
    assert.equal(d.user.entitlement, 'trial');
  });

  it('connects a gitee repo', async () => {
    const r = await request(
      'POST',
      '/api/pro/repos',
      { url: 'https://gitee.com/heyangyan/architecture_viewer.git', token: 't-demo' },
      cookie
    );
    assert.equal(r.status, 201, r.body);
    const d = JSON.parse(r.body);
    repoId = d.repo.id;
    secret = d.webhookSecret;
    assert.ok(secret);
    assert.match(d.webhookUrl, /\/api\/pro\/webhook/);
  });

  it('hosted webhook posts a drift comment for demo-drift', async () => {
    const comments = [];
    global.__AV_POST_COMMENT = async (job, token, markdown) => {
      comments.push({ job, token, markdown });
      return { id: 1 };
    };
    const r = await request('POST', '/api/pro/webhook', {
      action: 'open',
      pull_request: { number: 42, title: 'feat', head: { ref: 'main', sha: 'abc123' } },
      project: {
        path_with_namespace: 'heyangyan/architecture_viewer',
        clone_url: 'https://gitee.com/heyangyan/architecture_viewer.git'
      },
      repoId,
      fixturePath: path.join(ROOT, 'eval/demo-drift'),
      __headers: { 'X-Gitee-Token': secret, 'X-Gitee-Event': 'Merge Request Hook' }
    });
    delete global.__AV_POST_COMMENT;
    assert.equal(r.status, 200, r.body);
    const d = JSON.parse(r.body);
    assert.equal(d.checkOk, false);
    assert.equal(d.posted, true);
    assert.equal(comments.length, 1);
    assert.match(comments[0].markdown, /红灯/);
    assert.equal(comments[0].job.pr, 42);
  });

  it('redeems a license into Pro', async () => {
    const key = billing.issueLicense('seed@example.com', 31);
    const r = await request('POST', '/api/pro/billing/redeem', { key }, cookie);
    assert.equal(r.status, 200, r.body);
    const d = JSON.parse(r.body);
    assert.equal(d.user.entitlement, 'pro');
    assert.equal(d.user.active, true);
  });

  it('admin grant requires token', async () => {
    const r = await request('POST', '/api/pro/admin/grant', { email: 'seed@example.com' });
    assert.equal(r.status, 403);
  });

  it('health advertises pro', async () => {
    const r = await request('GET', '/api/health');
    const d = JSON.parse(r.body);
    assert.equal(d.pro, true);
  });

  it('account page is served', async () => {
    const r = await request('GET', '/account.html');
    assert.equal(r.status, 200);
    assert.match(r.body, /本地项目/);
    const guide = await request('GET', '/local-pro.html');
    assert.equal(guide.status, 200);
    assert.match(guide.body, /本地 Pro 上手/);
  });
});

describe('Pro Local folder check', () => {
  let cookie = '';
  let localId = '';

  before(async () => {
    const r = await request('POST', '/api/pro/signup', {
      email: 'local@example.com',
      password: 'password1'
    });
    assert.equal(r.status, 200, r.body);
    cookie = r.cookie;
  });

  it('rejects a relative path', async () => {
    const r = await request('POST', '/api/pro/local', { path: 'eval/demo-drift' }, cookie);
    assert.equal(r.status, 400);
  });

  it('adds showcase-shop and checks green', async () => {
    const folder = path.join(ROOT, 'examples/showcase-shop');
    const add = await request('POST', '/api/pro/local', { path: folder, intervalMin: 0 }, cookie);
    assert.equal(add.status, 201, add.body);
    const d = JSON.parse(add.body);
    localId = d.project.id;
    const check = await request('POST', '/api/pro/local/' + localId + '/check', { notify: false }, cookie);
    assert.equal(check.status, 200, check.body);
    const c = JSON.parse(check.body);
    assert.equal(c.checkOk, true);
    assert.match(c.markdown, /绿灯/);
  });

  it('demo-drift is a red light and can notify', async () => {
    const sent = [];
    global.__AV_NOTIFY = async (url, markdown) => {
      sent.push({ url, markdown });
    };
    const folder = path.join(ROOT, 'eval/demo-drift');
    const add = await request(
      'POST',
      '/api/pro/local',
      { path: folder, intervalMin: 0, wecomWebhook: 'https://example.test/wecom' },
      cookie
    );
    assert.equal(add.status, 201, add.body);
    const id = JSON.parse(add.body).project.id;
    const check = await request('POST', '/api/pro/local/' + id + '/check', { notify: true }, cookie);
    delete global.__AV_NOTIFY;
    assert.equal(check.status, 200, check.body);
    const c = JSON.parse(check.body);
    assert.equal(c.checkOk, false);
    assert.equal(c.notified, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].markdown, /红灯/);
  });

  it('expired trial can still check by hand; notify is skipped', async () => {
    const store = require('../web/lib/pro/store');
    const db = store.load();
    const user = db.users.find((u) => u.email === 'local@example.com');
    user.trialUntil = new Date(Date.now() - 1000).toISOString();
    user.plan = 'trial';
    user.paidUntil = null;
    store.save(db);
    const sent = [];
    global.__AV_NOTIFY = async (url, markdown) => {
      sent.push({ url, markdown });
    };
    const r = await request('POST', '/api/pro/local/' + localId + '/check', { notify: true }, cookie);
    delete global.__AV_NOTIFY;
    assert.equal(r.status, 200, r.body);
    const d = JSON.parse(r.body);
    assert.equal(d.checkOk, true);
    assert.equal(d.notified, false);
    assert.equal(d.notifySkipped, 'expired');
    assert.equal(sent.length, 0);
  });

  it('expired trial can save a folder but auto/wecom are stripped', async () => {
    const folder = path.join(ROOT, 'eval/demo-drift');
    const r = await request(
      'POST',
      '/api/pro/local',
      { path: folder, intervalMin: 15, wecomWebhook: 'https://example.test/wecom' },
      cookie
    );
    assert.equal(r.status, 201, r.body);
    const d = JSON.parse(r.body);
    assert.equal(d.limited, true);
    assert.equal(d.project.intervalMin, 0);
  });
});
