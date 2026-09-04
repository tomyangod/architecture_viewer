'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-gate-cfg-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-gate-data-'));
process.env.ARCH_CONFIG_DIR = configDir;
process.env.ARCH_PRO_DATA = dataDir;
process.env.ARCH_PRO_SECRET = 'test-secret-gate';
process.env.NODE_ENV = 'test';
delete process.env.ARCH_API_BASE;
delete process.env.ARCH_PRO_FEATURES;
delete process.env.ARCH_PRO_FEATURES_OFF;
delete process.env.ARCH_PRICING_URL;

const client = require('../lib/pro/auth-client');
const store = require('../lib/pro/store');
const { canUsePro } = require('../lib/pro/entitlement');
const features = require('../lib/pro/features');
const { generateToDir } = require('../lib/index');
const { main } = require('../lib/cli');
const { handler } = require('../web/server');

async function login(email) {
  const t = client.transport();
  const req = await t.requestCode(email);
  return client.loginFlow({ email, code: req.devCode });
}

function expireCurrentUser(email) {
  const db = store.load();
  const user = db.users.find((u) => u.email === email);
  assert.ok(user, 'user exists');
  user.trialUntil = new Date(Date.now() - 60 * 1000).toISOString();
  user.plan = 'trial';
  delete user.paidUntil;
  store.save(db);
}

function httpRequest(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const headers = {};
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (token) headers.Authorization = 'Bearer ' + token;
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

async function captureMain(argv) {
  const logs = [];
  const errs = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const code = await main(argv);
    return { code, out: logs.join('\n'), err: errs.join('\n') };
  } catch (e) {
    errs.push(e.message || String(e));
    return { code: 1, out: logs.join('\n'), err: errs.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe('W05-01 Pro gate', () => {
  beforeEach(() => {
    client.clearAuth();
    delete process.env.ARCH_PRO_FEATURES;
    delete process.env.ARCH_PRO_FEATURES_OFF;
    delete process.env.ARCH_PRICING_URL;
  });

  it('requirePro when logged out is UPGRADE_REQUIRED and includes pricing URL', async () => {
    await assert.rejects(() => client.requirePro({ feature: 'cloud_refine' }), (e) => {
      assert.equal(e.code, 'UPGRADE_REQUIRED');
      assert.match(e.message, /定价/);
      assert.match(e.message, /https?:\/\//);
      assert.equal(e.pricingUrl, features.pricingUrl());
      return true;
    });
  });

  it('trial login can run requirePro', async () => {
    const user = await login('gate-ok@example.com');
    assert.equal(canUsePro(user), true);
    const gated = await client.requirePro({ feature: 'incremental_sync' });
    assert.equal(gated.email, 'gate-ok@example.com');
  });

  it('expired trial is UPGRADE_REQUIRED', async () => {
    await login('gate-exp@example.com');
    expireCurrentUser('gate-exp@example.com');
    await assert.rejects(() => client.requirePro({ feature: 'cloud_refine' }), (e) => {
      assert.equal(e.code, 'UPGRADE_REQUIRED');
      assert.match(e.message, /到期|定价/);
      return true;
    });
  });

  it('server can disable a feature', async () => {
    process.env.ARCH_PRO_FEATURES_OFF = 'cloud_refine';
    await login('gate-off@example.com');
    await assert.rejects(() => client.requirePro({ feature: 'cloud_refine' }), (e) => {
      assert.equal(e.code, 'FEATURE_DISABLED');
      return true;
    });
    const syncUser = await client.requirePro({ feature: 'incremental_sync' });
    assert.equal(syncUser.email, 'gate-off@example.com');
  });

  it('Community generate never requires login', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-gate-comm-'));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Gate Shop\n');
    fs.mkdirSync(path.join(tmp, 'backend'));
    fs.writeFileSync(path.join(tmp, 'backend', 'main.py'), 'class Worker:\n    pass\n');
    const kit = path.join(tmp, 'kit');
    const result = generateToDir(tmp, kit);
    assert.equal(result.protocol.ok, true, result.protocol.errors.join('\n'));
  });

  it('CLI pro refine without login prints upgrade + pricing', async () => {
    const r = await captureMain(['pro', 'refine']);
    assert.equal(r.code, 1);
    assert.match(r.err, /定价/);
    assert.match(r.err, /https?:\/\//);
  });

  it('CLI pro refine after login is executable', async () => {
    await login('gate-cli@example.com');
    const r = await captureMain(['pro', 'refine', os.tmpdir()]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /云端精修/);
    assert.match(r.out, /Community/);
  });

  it('HTTP refine/sync: 401 with pricingUrl; token 200', async () => {
    const anon = await httpRequest('POST', '/api/pro/refine', {});
    assert.equal(anon.status, 401, anon.body);
    const anonBody = JSON.parse(anon.body);
    assert.equal(anonBody.code, 'UPGRADE_REQUIRED');
    assert.match(String(anonBody.pricingUrl), /https?:\/\//);

    const t = client.transport();
    const req = await t.requestCode('gate-http@example.com');
    const out = await t.verify('gate-http@example.com', req.devCode);
    const ok = await httpRequest('POST', '/api/pro/sync', {}, out.token);
    assert.equal(ok.status, 200, ok.body);
    assert.equal(JSON.parse(ok.body).placeholder, true);

    const feat = await httpRequest('GET', '/api/pro/features');
    assert.equal(feat.status, 200, feat.body);
    const listed = JSON.parse(feat.body).features.map((f) => f.id);
    assert.ok(listed.includes('cloud_refine'));
    assert.ok(listed.includes('incremental_sync'));
  });
});
