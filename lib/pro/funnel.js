'use strict';

/**
 * 付费漏斗事件（W09-01）。
 * 写入 .data/pro/funnel.log；若开启 ARCH_TELEMETRY 再镜像到 telemetry.log（无邮箱/路径）。
 */

const ALLOWED = new Set([
  'signup',
  'trial',
  'login',
  'login_code_requested',
  'login_code_verified',
  'paywall_shown',
  'upgrade_required',
  'pay',
  'checkout',
  'team_order'
]);

function emit(event, props) {
  const name = String(event || '');
  if (!name || !ALLOWED.has(name)) return;
  const payload = props && typeof props === 'object' ? props : {};
  try {
    // store.track → funnel.log，并在开启遥测时镜像 funnel_*（见 store.js）
    require('./store').track(name, payload);
  } catch {
    /* ignore */
  }
}

/**
 * 首次漂移 / 风险发现后的非阻断升级提示。
 * @returns {boolean} 是否打印了提示
 */
function maybePaywallAfterValueMoment(opts) {
  const o = opts || {};
  const findings = o.findingsCount || 0;
  const driftMissing = o.driftMissing || 0;
  const level = String(o.level || '').toLowerCase();
  const trigger =
    o.force ||
    findings > 0 ||
    driftMissing > 0 ||
    (level && level !== 'none' && level !== 'low');
  if (!trigger) return false;

  const features = require('./features');
  const reason = o.reason || (driftMissing > 0 ? 'drift' : 'session_risk');
  emit('paywall_shown', {
    reason,
    findings: findings,
    drift_missing: driftMissing,
    level: level || null
  });

  console.log('');
  console.log('—— Pro 提示（不阻断 Community）——');
  console.log('刚检出架构风险/漂移。可免费继续修图；若要本机文件夹盯梢、企微红灯或托管 PR 评论：');
  console.log('  开启 7 天试用：arch-viewer auth login   （首次登录即 trial）');
  console.log('  网页注册试用：打开 /account.html →「注册并试用 7 天」');
  console.log('  定价：' + features.pricingUrl());
  console.log('Community 的 generate / check / session 永不登录墙。');
  return true;
}

module.exports = { emit, maybePaywallAfterValueMoment, ALLOWED };
