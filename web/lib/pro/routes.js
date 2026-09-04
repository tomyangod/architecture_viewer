'use strict';

const crypto = require('crypto');
// Pro 核心逻辑（账号/存储/权益/加密）位于 lib/pro，供 CLI / MCP / web 三方复用
const store = require('../../../lib/pro/store');
const auth = require('../../../lib/pro/auth');
const { publicUser, isActive } = require('../../../lib/pro/entitlement');
const cryptoUtil = require('../../../lib/pro/crypto');
const billing = require('./billing');
const providers = require('./providers');
const { runHostedCheck } = require('./host-drift');
const { formatComment } = require('./comment');
const { safeClone, cleanup } = require('../clone');
const local = require('./local');

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket && req.socket.remoteAddress || '';
}

function bearerToken(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers['authorization'] || ''));
  return m ? m[1].trim() : null;
}

function json(res, status, body, extraHeaders) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extraHeaders || {});
  res.writeHead(status, h);
  res.end(JSON.stringify(body));
}

function setSession(res, token, payload, status) {
  json(res, status || 200, payload, { 'Set-Cookie': auth.sessionCookie(token, 30 * 24 * 3600) });
}

function repoPublic(r) {
  return {
    id: r.id,
    url: r.url,
    owner: r.owner,
    repo: r.repo,
    provider: r.provider,
    webhookSecret: r.webhookSecret,
    hasToken: !!r.tokenEnc,
    createdAt: r.createdAt
  };
}

async function handlePro(req, res, url, rawBuf) {
  const pathname = url.pathname;
  const method = req.method;
  const raw = rawBuf || Buffer.alloc(0);
  let body = {};
  if (raw.length && /json/i.test(String(req.headers['content-type'] || '')) || (raw.length && raw[0] === 123)) {
    try {
      body = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      return json(res, 400, { error: 'invalid JSON' });
    }
  }

  if (method === 'GET' && pathname === '/api/pro/health') {
    return json(res, 200, {
      ok: true,
      stripe: billing.stripeEnabled(),
      publicUrl: billing.publicUrl()
    });
  }

  if (method === 'GET' && pathname === '/api/pro/features') {
    const features = require('../../../lib/pro/features');
    return json(res, 200, {
      features: features.listFeatures(),
      pricingUrl: features.pricingUrl(),
      communityAlways: features.COMMUNITY_ALWAYS
    });
  }

  if (method === 'POST' && pathname === '/api/pro/refine') {
    const user = auth.requireProFeature(req, 'cloud_refine');
    return json(res, 200, {
      ok: true,
      placeholder: true,
      feature: 'cloud_refine',
      message: '云端精修已受理（占位）：将使用托管模型重绘变动模块。本机 generate --refine（自带 Key）仍属 Community。',
      user: publicUser(user)
    });
  }

  if (method === 'POST' && pathname === '/api/pro/sync') {
    const user = auth.requireProFeature(req, 'incremental_sync');
    return json(res, 200, {
      ok: true,
      placeholder: true,
      feature: 'incremental_sync',
      message: '增量同步已排队（占位）：仅重生成变动模块。全量 generate 仍属 Community。',
      user: publicUser(user)
    });
  }

  if (method === 'POST' && pathname === '/api/pro/signup') {
    const out = auth.signup(body.email, body.password, clientIp(req));
    return setSession(res, out.token, { user: out.user });
  }
  if (method === 'POST' && pathname === '/api/pro/login') {
    const out = auth.login(body.email, body.password, clientIp(req));
    return setSession(res, out.token, { user: out.user });
  }
  if (method === 'POST' && pathname === '/api/pro/logout') {
    auth.logout(req);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }
  if (method === 'GET' && pathname === '/api/pro/me') {
    const user = auth.currentUser(req);
    if (!user) return json(res, 401, { error: '请先登录' });
    const db = store.load();
    const repos = db.repos.filter((r) => r.userId === user.id).map(repoPublic);
    const locals = (db.locals || []).filter((p) => p.userId === user.id).map(local.localPublic);
    const events = (db.events || []).filter((e) => e.userId === user.id).slice(0, 15);
    return json(res, 200, {
      user: publicUser(user),
      repos,
      locals,
      localEnabled: local.localEnabled(),
      events,
      webhookBase: billing.publicUrl() + '/api/pro/webhook'
    });
  }

  // 邮箱验证码（passwordless）登录：CLI 与网页共用
  if (method === 'POST' && pathname === '/api/pro/auth/request-code') {
    const out = auth.requestLoginCode(body.email, clientIp(req));
    return json(res, 200, { ok: true, expiresInSec: out.expiresInSec, devCode: out.devCode });
  }
  if (method === 'POST' && pathname === '/api/pro/auth/verify-code') {
    const out = auth.verifyLoginCode(body.email, body.code);
    // 同时下发 cookie（浏览器）与 token（CLI Bearer）
    return setSession(res, out.token, { token: out.token, user: out.user });
  }
  if (method === 'GET' && pathname === '/api/pro/auth/me') {
    const token = bearerToken(req) || auth.parseCookies(req.headers && req.headers.cookie).av_session;
    const user = token ? auth.sessionByToken(token) : null;
    if (!user) return json(res, 401, { error: '请先登录' });
    return json(res, 200, { user: publicUser(user) });
  }
  if (method === 'POST' && pathname === '/api/pro/auth/logout') {
    const token = bearerToken(req) || auth.parseCookies(req.headers && req.headers.cookie).av_session;
    if (token) auth.logoutToken(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  if (method === 'POST' && pathname === '/api/pro/repos') {
    const user = auth.requireActive(req);
    const parsed = providers.parseRepoUrl(body.url);
    if (!parsed) return json(res, 400, { error: '请提供 GitHub / Gitee HTTPS 仓库 URL' });
    const db = store.load();
    const exists = db.repos.find(
      (r) => r.userId === user.id && r.owner === parsed.owner && r.repo === parsed.repo
    );
    if (exists) {
      if (body.token) exists.tokenEnc = cryptoUtil.encrypt(body.token);
      store.save(db);
      return json(res, 200, {
        repo: repoPublic(exists),
        webhookUrl: billing.publicUrl() + '/api/pro/webhook',
        webhookSecret: exists.webhookSecret
      });
    }
    const rec = {
      id: store.id(),
      userId: user.id,
      url: body.url,
      owner: parsed.owner,
      repo: parsed.repo,
      provider: parsed.provider,
      webhookSecret: crypto.randomBytes(16).toString('hex'),
      tokenEnc: body.token ? cryptoUtil.encrypt(body.token) : '',
      createdAt: new Date().toISOString()
    };
    db.repos.push(rec);
    store.save(db);
    store.track('connect_repo', { userId: user.id, repo: parsed.owner + '/' + parsed.repo });
    return json(res, 201, {
      repo: repoPublic(rec),
      webhookUrl: billing.publicUrl() + '/api/pro/webhook',
      webhookSecret: rec.webhookSecret
    });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/pro/repos/')) {
    const user = auth.requireUser(req);
    const id = pathname.slice('/api/pro/repos/'.length).replace(/\/$/, '');
    const db = store.load();
    const before = db.repos.length;
    db.repos = db.repos.filter((r) => !(r.id === id && r.userId === user.id));
    if (db.repos.length === before) return json(res, 404, { error: '仓库未找到' });
    store.save(db);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/pro/billing/checkout') {
    const user = auth.requireUser(req);
    const session = await billing.createCheckout(user);
    store.track('checkout', { userId: user.id });
    return json(res, 200, session);
  }

  if (method === 'POST' && pathname === '/api/pro/billing/redeem') {
    const user = auth.requireUser(req);
    const updated = billing.redeemLicense(user.email, body.key);
    return json(res, 200, { user: publicUser(updated) });
  }

  if (method === 'POST' && pathname === '/api/pro/billing/stripe') {
    const sig = req.headers['stripe-signature'];
    const secret = process.env.ARCH_STRIPE_WEBHOOK_SECRET || '';
    if (secret && !billing.verifyStripeSig(raw.toString('utf8'), sig, secret)) {
      return json(res, 401, { error: 'Stripe 签名无效' });
    }
    let event;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(res, 400, { error: 'invalid JSON' });
    }
    const applied = billing.applyStripeEvent(event);
    return json(res, 200, applied);
  }

  if (method === 'POST' && pathname === '/api/pro/admin/grant') {
    const admin = process.env.ARCH_PRO_ADMIN_TOKEN || '';
    const got = req.headers['x-admin-token'] || body.adminToken;
    if (!admin || got !== admin) return json(res, 403, { error: '管理员令牌无效' });
    const db = store.load();
    const user = auth.findUserByEmail(db, body.email);
    if (!user) return json(res, 404, { error: '用户不存在' });
    if (body.plan === 'team') {
      billing.grantTeam(user, body.days || 365, 'admin', body.repoUrl);
    } else {
      billing.grantPro(user, body.days || 31, 'admin');
    }
    store.save(db);
    store.track('pay', { userId: user.id, source: 'admin', plan: user.plan });
    return json(res, 200, { user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/pro/admin/license') {
    const admin = process.env.ARCH_PRO_ADMIN_TOKEN || '';
    const got = req.headers['x-admin-token'] || body.adminToken;
    if (!admin || got !== admin) return json(res, 403, { error: '管理员令牌无效' });
    const key = billing.issueLicense(body.email, body.days || 31);
    return json(res, 200, { key });
  }

  if (method === 'POST' && pathname === '/api/pro/local') {
    const user = auth.requireUser(req);
    const out = local.upsertLocal(user, body);
    return json(res, 201, {
      project: local.localPublic(out.rec),
      limited: !!out.limited,
      note: out.limited
        ? '试用已到期：已保存路径，仅可手动「现在检查」。自动检查与企业微信需兑换许可证。'
        : undefined
    });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/pro/local/')) {
    const user = auth.requireUser(req);
    const rest = pathname.slice('/api/pro/local/'.length).replace(/\/$/, '');
    const id = rest.replace(/\/check$/, '');
    if (rest.endsWith('/check')) return json(res, 405, { error: '请用 POST 执行检查' });
    const db = store.load();
    const before = (db.locals || []).length;
    db.locals = (db.locals || []).filter((p) => !(p.id === id && p.userId === user.id));
    if (db.locals.length === before) return json(res, 404, { error: '本地项目未找到' });
    store.save(db);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname.startsWith('/api/pro/local/') && pathname.endsWith('/check')) {
    const user = auth.requireUser(req);
    const id = pathname.slice('/api/pro/local/'.length, -'/check'.length);
    const db = store.load();
    const rec = local.findOwned(db, user, id);
    if (!rec) return json(res, 404, { error: '本地项目未找到' });
    const wantNotify = body.notify !== false;
    const active = isActive(user).ok;
    const notify = wantNotify && active;
    const out = await local.runLocalCheck(user, rec, { notify });
    return json(res, 200, {
      ok: true,
      checkOk: out.check.ok,
      notified: out.notified,
      notifyError: out.notifyError,
      notifySkipped: wantNotify && !active ? 'expired' : null,
      project: out.project,
      markdown: out.check.markdown,
      note: wantNotify && !active ? '试用已到期：检查结果已写入控制台，企业微信推送需兑换许可证。' : undefined
    });
  }

  if (method === 'POST' && pathname === '/api/pro/webhook') {
    return handleIncomingWebhook(req, res, raw, body);
  }

  return null;
}

async function handleIncomingWebhook(req, res, raw, body) {
  const db = store.load();
  const gh = req.headers['x-github-event'] || req.headers['X-GitHub-Event'];
  const gitee = req.headers['x-gitee-event'] || req.headers['X-Gitee-Event'];

  let matched = null;
  if (gitee) {
    const tokenHdr = req.headers['x-gitee-token'] || req.headers['X-Gitee-Token'];
    matched = db.repos.find((r) => r.provider === 'gitee' && r.webhookSecret === tokenHdr);
  }
  if (!matched && gh) {
    matched = db.repos.find((r) => {
      if (r.provider === 'gitee') return false;
      try {
        return providers.verifyGithub(req.headers, raw, r.webhookSecret);
      } catch {
        return false;
      }
    });
  }
  if (!matched && (process.env.NODE_ENV === 'test' || process.env.ARCH_PRO_FIXTURE === '1') && body && body.repoId) {
    matched = db.repos.find((r) => r.id === body.repoId);
  }
  if (!matched) {
    return json(res, 404, { error: '未识别的仓库 webhook（请确认 Secret / Token 与控制台一致）' });
  }

  const ownerUser = db.users.find((u) => u.id === matched.userId);
  const ent = isActive(ownerUser);
  if (!ent.ok) {
    store.track('drift_blocked', { userId: matched.userId, reason: 'expired' });
    return json(res, 402, { error: '该仓库所属账号 Pro 已到期' });
  }

  let job;
  try {
    job = providers.parseWebhook(req.headers, body, raw, matched.webhookSecret);
  } catch (e) {
    return json(res, e.status || 400, { error: e.message });
  }
  if (job.skip) return json(res, 200, { ok: true, skipped: job.reason });

  job.owner = job.owner || matched.owner;
  job.repo = job.repo || matched.repo;
  job.provider = job.provider || matched.provider;

  const token = matched.tokenEnc ? cryptoUtil.decrypt(matched.tokenEnc) : '';
  const fixture =
    (process.env.NODE_ENV === 'test' || process.env.ARCH_PRO_FIXTURE === '1') && body.fixturePath
      ? body.fixturePath
      : null;

  let check;
  let cloned;
  try {
    if (fixture) {
      check = runHostedCheck(fixture, {
        repoLabel: job.owner + '/' + job.repo,
        pr: job.pr,
        sha: job.sha
      });
    } else {
      const cloneUrl = job.cloneUrl || matched.url;
      cloned = await safeClone(cloneUrl, { token, branch: job.branch });
      check = runHostedCheck(cloned, {
        repoLabel: job.owner + '/' + job.repo,
        pr: job.pr,
        sha: job.sha
      });
    }
  } finally {
    if (cloned) cleanup(cloned);
  }

  store.track(check.ok ? 'drift_ok' : 'drift_found', {
    userId: matched.userId,
    repo: job.owner + '/' + job.repo,
    pr: job.pr
  });
  db.events.unshift({
    id: store.id(),
    userId: matched.userId,
    repoId: matched.id,
    ok: check.ok,
    pr: job.pr,
    at: new Date().toISOString(),
    missing: ((check.drift && check.drift.missing) || []).length,
    errors: ((check.protocol && check.protocol.errors) || []).length
  });
  db.events = db.events.slice(0, 200);
  store.save(db);

  const markdown = check.markdown || formatComment(check);
  let posted = false;
  let postError = null;
  const poster = global.__AV_POST_COMMENT || providers.upsertPrComment;
  try {
    if (job.pr && token) {
      await poster(job, token, markdown);
      posted = true;
    } else if (job.pr && (process.env.NODE_ENV === 'test' || process.env.ARCH_PRO_FIXTURE === '1')) {
      await poster(job, token || 'test', markdown);
      posted = true;
    }
  } catch (e) {
    postError = e.message;
  }

  return json(res, 200, {
    ok: true,
    checkOk: check.ok,
    posted,
    postError,
    pr: job.pr,
    markdown
  });
}

module.exports = { handlePro };
