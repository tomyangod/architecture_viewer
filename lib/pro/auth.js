'use strict';

const crypto = require('crypto');
const store = require('./store');
const cryptoUtil = require('./crypto');
const { trialUntilFrom, publicUser, isActive } = require('./entitlement');

const SESSION_DAYS = 30;
const LOGIN_CODE_TTL_MS = 10 * 60 * 1000; // 验证码 10 分钟有效
const LOGIN_CODE_MAX_ATTEMPTS = 5;
const loginHits = new Map();

function rateLimit(ip) {
  const key = ip || 'unknown';
  const now = Date.now();
  const row = loginHits.get(key) || { n: 0, reset: now + 15 * 60 * 1000 };
  if (now > row.reset) {
    row.n = 0;
    row.reset = now + 15 * 60 * 1000;
  }
  row.n += 1;
  loginHits.set(key, row);
  if (row.n > 30) {
    const err = new Error('登录过于频繁，请稍后再试');
    err.status = 429;
    throw err;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i < 1) return;
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

function sessionCookie(token, maxAgeSec) {
  const parts = [
    'av_session=' + encodeURIComponent(token),
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=' + String(maxAgeSec)
  ];
  if (process.env.ARCH_COOKIE_SECURE === '1') parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return 'av_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}

function findUserByEmail(db, email) {
  const e = String(email || '').trim().toLowerCase();
  return db.users.find((u) => u.email === e) || null;
}

function currentUser(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const token = cookies.av_session;
  if (!token) return null;
  const db = store.load();
  const sess = db.sessions.find((s) => s.token === token);
  if (!sess) return null;
  if (Date.parse(sess.expiresAt) < Date.now()) return null;
  return db.users.find((u) => u.id === sess.userId) || null;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) {
    const err = new Error('请先登录');
    err.status = 401;
    throw err;
  }
  return user;
}

function requireActive(req) {
  const user = requireUser(req);
  const ent = isActive(user);
  if (!ent.ok) {
    const err = new Error('试用或订阅已到期。自动检查与企业微信推送需兑换许可证或开通 Pro');
    err.status = 402;
    err.code = 'PAYMENT_REQUIRED';
    throw err;
  }
  return user;
}

function createSession(db, userId) {
  const token = cryptoUtil.randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  db.sessions.push({ token, userId, expiresAt });
  if (db.sessions.length > 5000) db.sessions = db.sessions.slice(-2000);
  return token;
}

function signup(email, password, ip) {
  rateLimit(ip);
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    const err = new Error('邮箱格式无效');
    err.status = 400;
    throw err;
  }
  if (String(password || '').length < 8) {
    const err = new Error('密码至少 8 位');
    err.status = 400;
    throw err;
  }
  const db = store.load();
  if (findUserByEmail(db, e)) {
    const err = new Error('该邮箱已注册');
    err.status = 409;
    throw err;
  }
  const createdAt = new Date().toISOString();
  const user = {
    id: store.id(),
    email: e,
    passwordHash: cryptoUtil.hashPassword(password),
    createdAt,
    plan: 'trial',
    trialUntil: trialUntilFrom(createdAt),
    paidUntil: null,
    stripeCustomerId: null
  };
  db.users.push(user);
  const token = createSession(db, user.id);
  store.save(db);
  store.track('signup', { userId: user.id });
  store.track('trial', { userId: user.id, until: user.trialUntil });
  return { token, user: publicUser(user) };
}

function login(email, password, ip) {
  rateLimit(ip);
  const db = store.load();
  const user = findUserByEmail(db, email);
  if (!user || !cryptoUtil.verifyPassword(password, user.passwordHash)) {
    const err = new Error('邮箱或密码错误');
    err.status = 401;
    throw err;
  }
  const token = createSession(db, user.id);
  store.save(db);
  store.track('login', { userId: user.id });
  return { token, user: publicUser(user) };
}

function logout(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const token = cookies.av_session;
  if (!token) return;
  const db = store.load();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  store.save(db);
}

// --- 邮箱验证码（passwordless）登录 ---
// 骨架阶段：不发真邮件，stub 模式把验证码打印到服务端日志并回传 devCode；
// 生产环境替换 sendLoginCode() 为邮件发送即可，协议不变。

function stubMode() {
  return process.env.NODE_ENV !== 'production';
}

function sendLoginCode(email, code) {
  if (stubMode()) {
    // 服务端日志可见（web/server.js 控制台或 CLI 本地模式控制台）
    console.log(`[auth] 登录验证码（stub，未发邮件）: ${code} → ${email}`);
    return;
  }
  // TODO(production): 接入邮件服务商（Resend / SES / 阿里云邮件推送）
  throw Object.assign(new Error('邮件发送未配置'), { status: 503, code: 'EMAIL_NOT_CONFIGURED' });
}

function requestLoginCode(email, ip) {
  rateLimit(ip);
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw Object.assign(new Error('邮箱格式无效'), { status: 400 });
  }
  const db = store.load();
  // 首次登录自动建档（trial 用户，无密码，走验证码）
  let user = findUserByEmail(db, e);
  if (!user) {
    const createdAt = new Date().toISOString();
    user = {
      id: store.id(),
      email: e,
      passwordHash: '',
      createdAt,
      plan: 'trial',
      trialUntil: trialUntilFrom(createdAt),
      paidUntil: null,
      stripeCustomerId: null
    };
    db.users.push(user);
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const now = Date.now();
  db.loginCodes = (db.loginCodes || [])
    .filter((c) => !c.consumed && Date.parse(c.expiresAt) > now)
    .slice(-9);
  db.loginCodes.push({
    email: e,
    codeHash: cryptoUtil.hmacHex(code),
    expiresAt: new Date(now + LOGIN_CODE_TTL_MS).toISOString(),
    consumed: false,
    attempts: 0
  });
  store.save(db);
  sendLoginCode(e, code);
  store.track('login_code_requested', { email: e });
  return { devCode: stubMode() ? code : null, expiresInSec: Math.round(LOGIN_CODE_TTL_MS / 1000) };
}

function verifyLoginCode(email, code) {
  const e = String(email || '').trim().toLowerCase();
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) {
    throw Object.assign(new Error('验证码为 6 位数字'), { status: 400 });
  }
  const db = store.load();
  const now = Date.now();
  const rec = (db.loginCodes || []).find(
    (r) => r.email === e && !r.consumed && Date.parse(r.expiresAt) > now
  );
  if (!rec) {
    throw Object.assign(new Error('验证码无效或已过期，请重新获取'), { status: 401 });
  }
  rec.attempts += 1;
  const expected = Buffer.from(rec.codeHash, 'hex');
  const actual = Buffer.from(cryptoUtil.hmacHex(c), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!ok) {
    if (rec.attempts >= LOGIN_CODE_MAX_ATTEMPTS) rec.consumed = true;
    store.save(db);
    throw Object.assign(new Error('验证码错误'), { status: 401 });
  }
  rec.consumed = true;
  const user = findUserByEmail(db, e);
  if (!user) {
    store.save(db);
    throw Object.assign(new Error('用户不存在，请重新获取验证码'), { status: 404 });
  }
  const token = createSession(db, user.id);
  store.save(db);
  store.track('login_code_verified', { userId: user.id });
  return { token, user: publicUser(user) };
}

function sessionByToken(token) {
  if (!token) return null;
  const db = store.load();
  const sess = db.sessions.find((s) => s.token === token);
  if (!sess) return null;
  if (Date.parse(sess.expiresAt) < Date.now()) return null;
  return db.users.find((u) => u.id === sess.userId) || null;
}

function logoutToken(token) {
  if (!token) return;
  const db = store.load();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  store.save(db);
}

module.exports = {
  parseCookies,
  sessionCookie,
  clearCookie,
  currentUser,
  requireUser,
  requireActive,
  signup,
  login,
  logout,
  findUserByEmail,
  publicUser,
  requestLoginCode,
  verifyLoginCode,
  sessionByToken,
  logoutToken
};
