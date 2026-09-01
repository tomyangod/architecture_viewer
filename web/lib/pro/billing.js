'use strict';

const crypto = require('crypto');
const store = require('./store');
const { findUserByEmail } = require('./auth');

function stripeEnabled() {
  return !!(process.env.ARCH_STRIPE_SECRET_KEY && process.env.ARCH_STRIPE_PRICE_ID);
}

function publicUrl() {
  return (process.env.ARCH_PUBLIC_URL || 'http://127.0.0.1:3847').replace(/\/$/, '');
}

async function createCheckout(user) {
  if (!stripeEnabled()) {
    const err = new Error('未配置 Stripe（ARCH_STRIPE_SECRET_KEY + ARCH_STRIPE_PRICE_ID）。国内客户可用许可证兑换或对公转账后由管理员开通。');
    err.status = 501;
    err.code = 'STRIPE_UNCONFIGURED';
    throw err;
  }
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', publicUrl() + '/account.html?paid=1');
  params.set('cancel_url', publicUrl() + '/account.html?paid=0');
  params.set('client_reference_id', user.id);
  params.set('customer_email', user.email);
  params.set('line_items[0][price]', process.env.ARCH_STRIPE_PRICE_ID);
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[userId]', user.id);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.ARCH_STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error('Stripe Checkout 失败：' + (data.error && data.error.message ? data.error.message : res.status));
    err.status = 502;
    throw err;
  }
  return { url: data.url, id: data.id };
}

function verifyStripeSig(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = {};
  String(header)
    .split(',')
    .forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const signed = ts + '.' + rawBody;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

function grantPro(user, days, source) {
  const d = days || 31;
  user.plan = 'pro';
  user.paidUntil = new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
  user.paidSource = source || 'manual';
  return user;
}

function licenseSecret() {
  return process.env.ARCH_PRO_LICENSE_SECRET || process.env.ARCH_PRO_SECRET || '';
}

function issueLicense(email, days) {
  const secret = licenseSecret();
  if (!secret) {
    const err = new Error('未配置 ARCH_PRO_LICENSE_SECRET');
    err.status = 500;
    throw err;
  }
  const payload = Buffer.from(
    JSON.stringify({
      email: String(email).trim().toLowerCase(),
      days: days || 31,
      exp: Date.now() + 90 * 24 * 3600 * 1000
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return 'avpro.' + payload + '.' + sig;
}

function redeemLicense(email, key) {
  const secret = licenseSecret();
  const parts = String(key || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'avpro') {
    const err = new Error('许可证格式无效');
    err.status = 400;
    throw err;
  }
  const expected = crypto.createHmac('sha256', secret).update(parts[1]).digest('base64url');
  if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) {
    const err = new Error('许可证签名无效');
    err.status = 400;
    throw err;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    const err = new Error('许可证无法解析');
    err.status = 400;
    throw err;
  }
  if (payload.exp && payload.exp < Date.now()) {
    const err = new Error('许可证已过期');
    err.status = 400;
    throw err;
  }
  if (payload.email && payload.email !== String(email).trim().toLowerCase()) {
    const err = new Error('许可证与当前账号邮箱不匹配');
    err.status = 400;
    throw err;
  }
  const db = store.load();
  const user = findUserByEmail(db, email);
  if (!user) {
    const err = new Error('用户不存在');
    err.status = 404;
    throw err;
  }
  grantPro(user, payload.days || 31, 'license');
  store.save(db);
  store.track('pay', { userId: user.id, source: 'license' });
  return user;
}

function applyStripeEvent(event) {
  if (!event || event.type !== 'checkout.session.completed') return { ok: false, reason: 'ignored' };
  const session = event.data && event.data.object;
  const userId = (session && session.client_reference_id) || (session && session.metadata && session.metadata.userId);
  const db = store.load();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, reason: 'user-not-found' };
  user.stripeCustomerId = session.customer || user.stripeCustomerId;
  grantPro(user, 31, 'stripe');
  store.save(db);
  store.track('pay', { userId: user.id, source: 'stripe', session: session.id });
  return { ok: true, userId: user.id };
}

module.exports = {
  stripeEnabled,
  createCheckout,
  verifyStripeSig,
  grantPro,
  issueLicense,
  redeemLicense,
  applyStripeEvent,
  publicUrl
};
