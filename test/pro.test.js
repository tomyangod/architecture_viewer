'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-'));
process.env.ARCH_PRO_DATA = dataDir;
process.env.ARCH_PRO_SECRET = 'test-secret-pro';
process.env.ARCH_PRO_LICENSE_SECRET = 'test-secret-pro';
process.env.ARCH_PRO_ADMIN_TOKEN = 'admin-test-token';
process.env.ARCH_PRO_FIXTURE = '1';
process.env.NODE_ENV = 'test';
process.env.ARCH_PUBLIC_URL = 'http://127.0.0.1:3847';

const { isActive, trialUntilFrom } = require('../lib/pro/entitlement');
const { formatComment, MARKER } = require('../web/lib/pro/comment');
const { parseWebhook, parseRepoUrl, upsertPrComment } = require('../web/lib/pro/providers');
const { runHostedCheck } = require('../web/lib/pro/host-drift');
const billing = require('../web/lib/pro/billing');
const { handler } = require('../web/server');
const CONFIRMED_LAYERS = JSON.stringify({ controller: 'controller', storage: 'storage' });

function writeTree(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

function gitInit(dir) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' });
}

function gitCommit(dir, msg) {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', msg], { cwd: dir, stdio: 'ignore' });
}

function makeLayeredRepo(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-repo-'));
  writeTree(dir, Object.assign({
    'controller/api.py': 'class Api:\n    pass\n',
    'storage/repo.py': 'class Repo:\n    pass\n'
  }, extra));
  gitInit(dir);
  gitCommit(dir, 'init');
  return dir;
}

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

  it('formats a no-baseline comment', () => {
    const md = formatComment({ ok: false, reason: 'NO_BASELINE', repo: 'a/b', pr: 3 });
    assert.match(md, /无法对照基线/);
    assert.match(md, /av-drift-bot/);
  });

  it('formats a rules-config-error comment distinctly', () => {
    const md = formatComment({ ok: false, reason: 'RULES_CONFIG_ERROR', repo: 'a/b', pr: 3, message: 'boom' });
    assert.match(md, /规则配置错误/);
    assert.match(md, /boom/);
    assert.doesNotMatch(md, /无法对照基线/);
  });

  it('upsert PATCHes the existing AV comment after the author fixes the PR', async () => {
    const calls = [];
    const fakeRequest = async (method, apiPath, token, json) => {
      calls.push({ method, apiPath, token, json });
      if (method === 'GET') return [{ id: 77, body: MARKER + '\n旧红灯评论' }];
      return { id: 77, updated: true };
    };
    const job = { provider: 'gitee', owner: 'o', repo: 'r', pr: 9 };
    const res = await upsertPrComment(job, 'tok', MARKER + '\n修复后绿灯', { request: fakeRequest });
    assert.equal(res.id, 77);
    assert.equal(calls.filter((c) => c.method === 'GET').length, 1);
    const patch = calls.filter((c) => c.method === 'PATCH');
    assert.equal(patch.length, 1);
    assert.match(patch[0].apiPath, /pulls\/comments\/77$/);
    assert.equal(patch[0].json.body.includes('修复后绿灯'), true);
    assert.equal(calls.some((c) => c.method === 'POST'), false, 'must not post a duplicate comment');
  });

  it('upsert POSTs a new comment when no AV comment exists yet', async () => {
    const calls = [];
    const fakeRequest = async (method, apiPath, token, json) => {
      calls.push({ method, apiPath, json });
      if (method === 'GET') return [{ id: 5, body: 'human review note' }];
      return { id: 99 };
    };
    const job = { provider: 'github', owner: 'o', repo: 'r', pr: 4 };
    await upsertPrComment(job, 'tok', MARKER + '\n首次红灯', { request: fakeRequest });
    const post = calls.filter((c) => c.method === 'POST');
    assert.equal(post.length, 1);
    assert.match(post[0].apiPath, /issues\/4\/comments$/);
    assert.equal(calls.some((c) => c.method === 'PATCH'), false);
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
        pull_request: {
          number: 9,
          title: 'x',
          head: { sha: 'fff', ref: 'feat', repo: { clone_url: 'https://github.com/o/r.git' } },
          base: { sha: 'abc1234', repo: { clone_url: 'https://github.com/o/r.git' } }
        },
        repository: { full_name: 'o/r', clone_url: 'https://github.com/o/r.git' }
      },
      raw,
      secret
    );
    assert.equal(job.skip, false);
    assert.equal(job.pr, 9);
    assert.equal(job.provider, 'github');
    assert.equal(job.baseSha, 'abc1234');
  });
});

describe('hosted check fixtures', () => {
  for (const confirmed of [false, true]) {
  it(`cross-layer import is ${confirmed ? 'blocking when configured' : 'review-only when inferred'}`, () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-base-'));
    writeTree(baseDir, {
      'controller/api.py': 'class Api:\n    pass\n',
      'storage/repo.py': 'class Repo:\n    pass\n'
    });
    const headDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-head-'));
    writeTree(headDir, {
      'controller/api.py': 'class Api:\n    pass\n',
      'storage/repo.py': 'from controller import api\nclass Repo:\n    pass\n'
    });
    if (confirmed) {
      writeTree(baseDir, { '.av/layers.json': CONFIRMED_LAYERS });
      writeTree(headDir, { '.av/layers.json': CONFIRMED_LAYERS });
    }
    const r = runHostedCheck(headDir, { repoLabel: 'demo/risk', pr: 1, baseDir });
    assert.equal(r.ok, !confirmed);
    assert.equal(r.riskSummary.gateLevel, confirmed ? 'high' : 'none');
    assert.equal(r.protocol, 'incremental');
    assert.ok((r.findings || []).some((f) => f.rule === 'cross-layer-violation'));
    assert.match(r.markdown, /风险/);
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(headDir, { recursive: true, force: true });
  });
  }

  it('identical trees are a green light', () => {
    const dir = makeLayeredRepo();
    const r = runHostedCheck(dir, { repoLabel: 'demo/shop' });
    assert.equal(r.ok, true);
    assert.match(r.markdown, /未检测到架构结构变更|无显著风险|绿灯/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('unreadable team rules abort the check instead of silently falling back to defaults', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-rules-base-'));
    writeTree(baseDir, {
      'controller/api.py': 'class Api:\n    pass\n',
      'storage/repo.py': 'class Repo:\n    pass\n'
    });
    const headDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-rules-head-'));
    writeTree(headDir, {
      'controller/api.py': 'class Api:\n    pass\n',
      'storage/repo.py': 'class Repo:\n    pass\n'
    });
    // A rules *path* that exists but cannot be read as a file (EISDIR).
    fs.mkdirSync(path.join(headDir, 'architecture-rules.yaml'));
    const r = runHostedCheck(headDir, { repoLabel: 'demo/rules', pr: 2, baseDir });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'RULES_CONFIG_ERROR');
    assert.equal(r.findings, undefined);
    assert.match(r.markdown, /规则配置错误/);
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(headDir, { recursive: true, force: true });
  });

  it('no rules file is allowed: defaults still produce a green light', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-norules-base-'));
    writeTree(baseDir, { 'svc/a.py': 'def f():\n    pass\n' });
    const headDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pro-norules-head-'));
    writeTree(headDir, { 'svc/a.py': 'def f():\n    pass\n' });
    const r = runHostedCheck(headDir, { repoLabel: 'demo/norules', pr: 3, baseDir });
    assert.equal(r.ok, true);
    assert.notEqual(r.reason, 'RULES_CONFIG_ERROR');
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(headDir, { recursive: true, force: true });
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

  it('hosted webhook posts an incremental-risk comment', async () => {
    const comments = [];
    global.__AV_POST_COMMENT = async (job, token, markdown) => {
      comments.push({ job, token, markdown });
      return { id: 1 };
    };
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-wh-base-'));
    const headDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-wh-head-'));
    writeTree(baseDir, {
      '.av/layers.json': CONFIRMED_LAYERS,
      'controller/api.py': 'class Api:\n    pass\n',
      'storage/repo.py': 'class Repo:\n    pass\n'
    });
    writeTree(headDir, {
      '.av/layers.json': CONFIRMED_LAYERS,
      'controller/api.py': 'class Api:\n    pass\n',
      'storage/repo.py': 'from controller import api\nclass Repo:\n    pass\n'
    });
    const r = await request('POST', '/api/pro/webhook', {
      action: 'open',
      pull_request: { number: 42, title: 'feat', head: { ref: 'main', sha: 'abc123' } },
      project: {
        path_with_namespace: 'heyangyan/architecture_viewer',
        clone_url: 'https://gitee.com/heyangyan/architecture_viewer.git'
      },
      repoId,
      fixturePath: headDir,
      fixtureBasePath: baseDir,
      __headers: { 'X-Gitee-Token': secret, 'X-Gitee-Event': 'Merge Request Hook' }
    });
    delete global.__AV_POST_COMMENT;
    assert.equal(r.status, 200, r.body);
    const d = JSON.parse(r.body);
    assert.equal(d.checkOk, false);
    assert.equal(d.posted, true);
    assert.equal(comments.length, 1);
    assert.match(comments[0].markdown, /风险|跨层/);
    assert.equal(comments[0].job.pr, 42);
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(headDir, { recursive: true, force: true });
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

  it('adds a clean git repo and checks green', async () => {
    const folder = makeLayeredRepo();
    const add = await request('POST', '/api/pro/local', { path: folder, intervalMin: 0 }, cookie);
    assert.equal(add.status, 201, add.body);
    const d = JSON.parse(add.body);
    localId = d.project.id;
    const check = await request('POST', '/api/pro/local/' + localId + '/check', { notify: false }, cookie);
    assert.equal(check.status, 200, check.body);
    const c = JSON.parse(check.body);
    assert.equal(c.checkOk, true);
    assert.match(c.markdown, /未检测到架构结构变更|无显著风险|绿灯/);
  });

  it('uncommitted cross-layer import is a red light and can notify', async () => {
    const sent = [];
    global.__AV_NOTIFY = async (url, markdown) => {
      sent.push({ url, markdown });
    };
    const folder = makeLayeredRepo({ '.av/layers.json': CONFIRMED_LAYERS });
    fs.writeFileSync(
      path.join(folder, 'storage/repo.py'),
      'from controller import api\nclass Repo:\n    pass\n'
    );
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
    assert.match(sent[0].markdown, /风险|跨层/);
  });

  it('scan and rules configuration failures expose checkOk=false over HTTP', async () => {
    const folder = makeLayeredRepo();
    try {
      const add = await request('POST', '/api/pro/local', { path: folder, intervalMin: 0 }, cookie);
      assert.equal(add.status, 201, add.body);
      const id = JSON.parse(add.body).project.id;
      // The extractor records oversized/unreadable source files in stats.parseErrors.
      fs.writeFileSync(path.join(folder, 'broken.js'), ' '.repeat(512001));
      const scan = await request('POST', '/api/pro/local/' + id + '/check', { notify: false }, cookie);
      assert.equal(scan.status, 200, scan.body);
      assert.equal(JSON.parse(scan.body).checkOk, false);
      assert.match(JSON.parse(scan.body).markdown, /扫描失败/);
      fs.unlinkSync(path.join(folder, 'broken.js'));
      for (const text of ['forbid_cross_layer: [', 'forbid_cross_layer:\n  - from: controller\n']) {
        fs.writeFileSync(path.join(folder, 'architecture-rules.yaml'), text);
        const check = await request('POST', '/api/pro/local/' + id + '/check', { notify: false }, cookie);
        assert.equal(check.status, 200, check.body);
        assert.equal(JSON.parse(check.body).checkOk, false);
        assert.match(JSON.parse(check.body).markdown, /规则配置错误/);
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it('expired trial can still check by hand; notify is skipped', async () => {
    const store = require('../lib/pro/store');
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
    const folder = makeLayeredRepo();
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
