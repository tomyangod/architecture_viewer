'use strict';

/**
 * 公开收款链接（落地页定价区 / 控制台）。
 * Stripe Checkout 仍在 web/lib/pro/billing.js；本模块只管「可点的人收链接」。
 *
 * 环境变量（运营替换为真实页）：
 *   ARCH_PAY_AFDIAN_URL   爱发电赞助页
 *   ARCH_PAY_WECHAT_URL   微信收款说明页（可指向 docs 锚点或自建页）
 *   ARCH_PAY_LEMON_URL    Lemon Squeezy 商品页（可沙箱店）
 */

const DOCS_BILLING =
  'https://gitee.com/heyangyan/architecture_viewer/blob/master/docs/billing.md';

const DEFAULTS = {
  afdian: 'https://afdian.com/a/architecture-viewer',
  wechat: DOCS_BILLING + '#微信收款',
  lemon: 'https://arch-viewer.lemonsqueezy.com/',
  lemonTeam: 'https://arch-viewer.lemonsqueezy.com/checkout/buy/team-repo-year',
  docs: DOCS_BILLING
};

function trimUrl(v) {
  const s = String(v || '').trim();
  return s || null;
}

function teamProduct() {
  return {
    sku: 'team-repo-year',
    priceCny: 999,
    priceLabel: '¥999 / 年 / 仓库',
    termDays: 365,
    features: ['ci_hosted', 'rules_pack', 'gallery']
  };
}

function sandboxMode() {
  return process.env.ARCH_BILLING_SANDBOX === '1' || process.env.NODE_ENV === 'test';
}

function paymentLinks() {
  const team = teamProduct();
  return {
    afdian: trimUrl(process.env.ARCH_PAY_AFDIAN_URL) || DEFAULTS.afdian,
    wechat: trimUrl(process.env.ARCH_PAY_WECHAT_URL) || DEFAULTS.wechat,
    lemon: trimUrl(process.env.ARCH_PAY_LEMON_URL) || DEFAULTS.lemon,
    lemonTeam: trimUrl(process.env.ARCH_PAY_LEMON_TEAM_URL) || DEFAULTS.lemonTeam,
    docs: DEFAULTS.docs,
    priceCny: 29,
    priceLabel: '¥29 / 月',
    team,
    note: '先收款再人工/半自动开通；SOP 见 docs/billing.md'
  };
}

/**
 * Team 下单：写入 pending 订单并返回 Lemon 结账链接。
 * 沙箱（NODE_ENV=test 或 ARCH_BILLING_SANDBOX=1）且邮箱已注册时当场开通。
 */
function createTeamOrder(body) {
  const store = require('../../lib/pro/store');
  const { findUserByEmail } = require('../../lib/pro/auth');
  const { grantTeam } = require('./pro/billing');
  const email = String((body && body.email) || '').trim().toLowerCase();
  const repoUrl = String((body && body.repoUrl) || '').trim();
  const channel = String((body && body.channel) || 'lemon').trim() || 'lemon';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('请填写有效邮箱');
    err.status = 400;
    throw err;
  }
  if (!/^https?:\/\//i.test(repoUrl)) {
    const err = new Error('请填写仓库 HTTPS URL');
    err.status = 400;
    throw err;
  }
  const product = teamProduct();
  const db = store.load();
  db.orders = db.orders || [];
  const order = {
    id: store.id(),
    sku: product.sku,
    email,
    repoUrl,
    channel,
    priceCny: product.priceCny,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);
  let granted = false;
  const user = findUserByEmail(db, email);
  if (sandboxMode() && user) {
    grantTeam(user, product.termDays, 'sandbox', repoUrl);
    order.status = 'sandbox-granted';
    granted = true;
  }
  store.save(db);
  store.track('team_order', { orderId: order.id, email, granted, channel });
  return {
    ok: true,
    orderId: order.id,
    status: order.status,
    priceCny: product.priceCny,
    checkoutUrl: paymentLinks().lemonTeam,
    granted,
    features: product.features,
    sandbox: sandboxMode()
  };
}

module.exports = { paymentLinks, DEFAULTS, DOCS_BILLING, teamProduct, sandboxMode, createTeamOrder };
