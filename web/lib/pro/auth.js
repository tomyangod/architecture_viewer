'use strict';

const store = require('./store');
const cryptoUtil = require('./crypto');
const { trialUntilFrom, publicUser, isActive } = require('./entitlement');

const SESSION_DAYS = 30;
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
    const err = new Error('Pro 试用或订阅已到期，请开通后继续使用托管漂移评论');
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
  publicUser
};
