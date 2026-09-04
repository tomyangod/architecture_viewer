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
  docs: DOCS_BILLING
};

function trimUrl(v) {
  const s = String(v || '').trim();
  return s || null;
}

function paymentLinks() {
  return {
    afdian: trimUrl(process.env.ARCH_PAY_AFDIAN_URL) || DEFAULTS.afdian,
    wechat: trimUrl(process.env.ARCH_PAY_WECHAT_URL) || DEFAULTS.wechat,
    lemon: trimUrl(process.env.ARCH_PAY_LEMON_URL) || DEFAULTS.lemon,
    docs: DEFAULTS.docs,
    priceCny: 29,
    priceLabel: '¥29 / 月',
    note: '先收款再人工/半自动开通；SOP 见 docs/billing.md'
  };
}

module.exports = { paymentLinks, DEFAULTS, DOCS_BILLING };
