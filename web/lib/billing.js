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
  'https://gitee.com/heyangyan/architecture_viewer/blob/master/docs/commercial/billing.md';

const DEFAULTS = {
  afdian: 'https://afdian.com/a/architecture-viewer',
  wechat: DOCS_BILLING + '#微信收款',
  lemon: 'https://arch-viewer.lemonsqueezy.com/',
  docs: DOCS_BILLING
};

function trimUrl(v) {
  const s = String(v || '').trim();
  return s || null;
}

/**
 * Team 在验证期（选项 B，2026-09-11 起）不开放自助下单：
 * 展示价保留 ¥99/人/月，但统一走「申请试点 → 人工报价」，
 * 避免展示按人月、订单却是 ¥999/仓/年的口径漂移。
 */
function teamPlan() {
  return {
    mode: 'manual-application',
    priceLabel: '¥99 / 人 / 月',
    note: 'Team 验证期仅接受试点申请。仓库 URL 选填，填写时才校验 http(s) 格式。'
    features: ['ci_hosted', 'rules_pack', 'gallery']
  };
}

function sandboxMode() {
  return process.env.ARCH_BILLING_SANDBOX === '1' || process.env.NODE_ENV === 'test';
}

function paymentLinks() {
  return {
    afdian: trimUrl(process.env.ARCH_PAY_AFDIAN_URL) || DEFAULTS.afdian,
    wechat: trimUrl(process.env.ARCH_PAY_WECHAT_URL) || DEFAULTS.wechat,
    lemon: trimUrl(process.env.ARCH_PAY_LEMON_URL) || DEFAULTS.lemon,
    docs: DEFAULTS.docs,
    priceCny: 29,
    priceLabel: '¥29 / 月',
    team: teamPlan(),
    note: 'Pro 先收款再人工/半自动开通；Team 验证期仅接受试点申请。SOP 见 docs/commercial/billing.md'
  };
}

/**
 * Team 试点申请：只登记意向，不产生订单、不带价格、不自动开通。
 * 沙箱也不开通——Team 一律人工处理。
 */
function createTeamApplication(body) {
  const store = require('../../lib/pro/store');
  const email = String((body && body.email) || '').trim().toLowerCase();
  const repoUrl = String((body && body.repoUrl) || '').trim();
  const note = String((body && body.note) || '').trim().slice(0, 500);
  const channel = String((body && body.channel) || 'landing').trim() || 'landing';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('请填写有效邮箱');
    err.status = 400;
    throw err;
  }
  if (repoUrl && !/^https?:\/\//i.test(repoUrl)) {
    const err = new Error('仓库 URL 需为 http(s) 地址；也可留空');
    err.status = 400;
    throw err;
  }
  const db = store.load();
  db.applications = db.applications || [];
  const dup = db.applications.find(
    (a) => a.kind === 'team-application' && a.email === email && a.repoUrl === repoUrl && a.status === 'pending'
  );
  const application = {
    id: store.id(),
    kind: 'team-application',
    email,
    repoUrl,
    note,
    channel,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.applications.push(application);
  store.save(db);
  store.track('team_application', { applicationId: application.id, email, channel, duplicate: !!dup });
  return {
    ok: true,
    applicationId: application.id,
    status: 'pending',
    duplicate: !!dup,
    mode: teamPlan().mode,
    message: '已收到 Team 试点申请，2 个工作日内人工联系报价。'
  };
}

module.exports = {
  paymentLinks,
  DEFAULTS,
  DOCS_BILLING,
  teamPlan,
  sandboxMode,
  createTeamApplication
};
