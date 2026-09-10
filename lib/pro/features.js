'use strict';

/**
 * Pro 特性开关（服务端可配）。
 *
 * 默认全开。关闭方式（任一即可）：
 *   ARCH_PRO_FEATURES='{"cloud_refine":false}'
 *   ARCH_PRO_FEATURES_OFF=cloud_refine,incremental_sync
 *
 * Community 命令（generate / check / session / --refine 自带 Key 等）
 * 不读本开关，永不禁用。见 COMMERCIAL.md。
 */

const CATALOG = {
  cloud_refine: {
    title: '云端精修',
    summary: '托管模型重绘变动模块（入口已接线，成片能力后续迭代）'
  },
  incremental_sync: {
    title: '增量同步',
    summary: '仅重生成变动模块（占位：登录后可演示门禁）'
  }
};

const COMMUNITY_ALWAYS = [
  'init',
  'generate',
  'generate --refine',
  'generate --skeleton',
  'check',
  'session start',
  'session report',
  'eval',
  'setup',
  'extract',
  'diff',
  'impact',
  'pr-comment'
];

const DEFAULT_PRICING_URL =
  'https://gitee.com/heyangyan/architecture_viewer/blob/master/docs/commercial/COMMERCIAL.md';

function pricingUrl() {
  const fromEnv = String(process.env.ARCH_PRICING_URL || '').trim();
  return fromEnv || DEFAULT_PRICING_URL;
}

function parseOverrides() {
  const out = {};
  const raw = process.env.ARCH_PRO_FEATURES;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) out[k] = !!v;
      }
    } catch {
      /* 坏 JSON 忽略，回退默认 */
    }
  }
  String(process.env.ARCH_PRO_FEATURES_OFF || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((id) => {
      out[id] = false;
    });
  return out;
}

function isFeatureEnabled(id) {
  if (!CATALOG[id]) return false;
  const overrides = parseOverrides();
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  return true;
}

function featureTitle(id) {
  return (CATALOG[id] && CATALOG[id].title) || id;
}

function listFeatures() {
  return Object.keys(CATALOG).map((id) => ({
    id,
    title: CATALOG[id].title,
    summary: CATALOG[id].summary,
    enabled: isFeatureEnabled(id)
  }));
}

function upgradeMessage(opts) {
  const o = opts || {};
  const title = o.feature ? featureTitle(o.feature) : 'Pro';
  const why =
    o.reason === 'expired'
      ? '试用或订阅已到期。'
      : '未登录或会话无效。';
  return [
    why + '「' + title + '」是 Pro 特性（¥29/月，含 7 天试用）。',
    '登录：arch-viewer auth login',
    '升级 / 定价：' + pricingUrl(),
    'Community 的 generate / check / session / --refine（自带 Key）永不禁用。'
  ].join('\n');
}

function upgradePayload(opts) {
  const o = opts || {};
  return {
    error: upgradeMessage(o),
    code: 'UPGRADE_REQUIRED',
    pricingUrl: pricingUrl(),
    feature: o.feature || null,
    communityUnaffected: true
  };
}

module.exports = {
  CATALOG,
  COMMUNITY_ALWAYS,
  DEFAULT_PRICING_URL,
  pricingUrl,
  isFeatureEnabled,
  featureTitle,
  listFeatures,
  upgradeMessage,
  upgradePayload
};
