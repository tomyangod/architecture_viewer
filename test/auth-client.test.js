'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 隔离配置目录与服务端数据目录（必须在 require 客户端前设置）
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-auth-cfg-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-auth-data-'));
process.env.ARCH_CONFIG_DIR = configDir;
process.env.ARCH_PRO_DATA = dataDir;
process.env.ARCH_PRO_SECRET = 'test-secret-auth';
process.env.NODE_ENV = 'test';
delete process.env.ARCH_API_BASE;

const client = require('../lib/pro/auth-client');
const { handler } = require('../web/server');

const EMAIL = 'cli@example.com';

describe('CLI auth client (local transport)', () => {
  beforeEach(() => {
    client.clearAuth();
  });

  it('persists token to auth.json with 0600 perms', async () => {
    const t = client.transport();
    assert.equal(t.mode, 'local');
    const req = await t.requestCode(EMAIL);
    assert.match(req.devCode, /^\d{6}$/);
    const out = await t.verify(EMAIL, req.devCode);
    assert.ok(out.token);
    assert.equal(out.user.email, EMAIL);
    assert.equal(out.user.entitlement, 'trial');

    client.saveAuth({ token: out.token, email: EMAIL, savedAt: new Date().toISOString(), mode: 'local' });
    assert.ok(fs.existsSync(client.authPath()));
    const mode = fs.statSync(client.authPath()).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('loginFlow + whoami survives a fresh load (restart simulation)', async () => {
    const t = client.transport();
    const req = await t.requestCode('flow@example.com');
    const user = await client.loginFlow({ email: 'flow@example.com', code: req.devCode });
    assert.equal(user.email, 'flow@example.com');

    // 模拟重启：重新读取磁盘上的 auth.json
    const who = await client.whoamiAsync();
    assert.ok(who);
    assert.equal(who.email, 'flow@example.com');
    assert.equal(who.plan, 'trial');
    assert.equal(who.active, true);
  });

  it('rejects wrong code', async () => {
    const t = client.transport();
    await t.requestCode('wrong@example.com');
    await assert.rejects(() => t.verify('wrong@example.com', '000000'), /验证码错误|无效|过期/);
  });

  it('rejects invalid email', async () => {
    const t = client.transport();
    await assert.rejects(() => t.requestCode('not-an-email'), /邮箱格式无效/);
  });

  it('whoami returns null when logged out', async () => {
    assert.equal(await client.whoamiAsync(), null);
  });

  it('requireUser throws AUTH_REQUIRED when logged out', async () => {
    await assert.rejects(() => client.requireUser(), (e) => {
      assert.equal(e.code, 'AUTH_REQUIRED');
      assert.match(e.message, /auth login/);
      return true;
    });
  });

  it('logout clears local credentials and server session', async () => {
    const t = client.transport();
    const req = await t.requestCode('logout@example.com');
    const out = await t.verify('logout@example.com', req.devCode);
    client.saveAuth({ token: out.token, email: 'logout@example.com', savedAt: new Date().toISOString(), mode: 'local' });
    assert.ok(await client.whoamiAsync());

    await client.logoutFlow();
    assert.equal(fs.existsSync(client.authPath()), false);
    assert.equal(await client.whoamiAsync(), null);
    // 服务端会话也已销毁
    assert.equal(await t.me(out.token), null);
  });
});

// ---- HTTP 端点（远程模式 / 网页共用） ----

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
      if (token) headers['Authorization'] = 'Bearer ' + token;
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

describe('HTTP passwordless auth endpoints', () => {
  it('request-code → verify-code → me(Bearer) → logout 全链路', async () => {
    const reqCode = await httpRequest('POST', '/api/pro/auth/request-code', { email: 'http@example.com' });
    assert.equal(reqCode.status, 200, reqCode.body);
    const codeBody = JSON.parse(reqCode.body);
    assert.match(codeBody.devCode, /^\d{6}$/);

    const verify = await httpRequest('POST', '/api/pro/auth/verify-code', {
      email: 'http@example.com',
      code: codeBody.devCode
    });
    assert.equal(verify.status, 200, verify.body);
    const vBody = JSON.parse(verify.body);
    assert.ok(vBody.token);
    assert.equal(vBody.user.email, 'http@example.com');

    const me = await httpRequest('GET', '/api/pro/auth/me', null, vBody.token);
    assert.equal(me.status, 200, me.body);
    assert.equal(JSON.parse(me.body).user.entitlement, 'trial');

    const meNoToken = await httpRequest('GET', '/api/pro/auth/me');
    assert.equal(meNoToken.status, 401);

    const logout = await httpRequest('POST', '/api/pro/auth/logout', {}, vBody.token);
    assert.equal(logout.status, 200);
    const meAfter = await httpRequest('GET', '/api/pro/auth/me', null, vBody.token);
    assert.equal(meAfter.status, 401);
  });

  it('verify-code with bad code returns 401', async () => {
    await httpRequest('POST', '/api/pro/auth/request-code', { email: 'bad@example.com' });
    const r = await httpRequest('POST', '/api/pro/auth/verify-code', { email: 'bad@example.com', code: '999999' });
    assert.equal(r.status, 401);
  });
});
