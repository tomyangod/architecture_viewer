'use strict';

const TRIAL_DAYS = 7;

function now() {
  return Date.now();
}

function trialUntilFrom(createdAt) {
  const t = Date.parse(createdAt) || now();
  return new Date(t + TRIAL_DAYS * 24 * 3600 * 1000).toISOString();
}

const TEAM_FEATURE_CATALOG = [
  { id: 'ci_hosted', title: 'CI 托管评论', ready: true },
  { id: 'rules_pack', title: 'architecture-rules 规范包', ready: true },
  { id: 'gallery', title: '共享图库', ready: false, placeholder: true }
];

function isActive(user, at) {
  const ts = at || now();
  if (!user) return { ok: false, reason: 'anonymous', plan: 'none' };
  if (user.plan === 'team') {
    const until = Date.parse(user.paidUntil || '') || 0;
    if (until > ts) return { ok: true, reason: 'team', plan: 'team', until: user.paidUntil };
  }
  if (user.plan === 'pro') {
    const until = Date.parse(user.paidUntil || '') || 0;
    if (until > ts) return { ok: true, reason: 'pro', plan: 'pro', until: user.paidUntil };
    // subscription lapsed
  }
  const trial = Date.parse(user.trialUntil || '') || 0;
  if (trial > ts) return { ok: true, reason: 'trial', plan: 'trial', until: user.trialUntil };
  return { ok: false, reason: 'expired', plan: user.plan || 'expired' };
}

function publicUser(user) {
  if (!user) return null;
  const ent = isActive(user);
  return {
    id: user.id,
    email: user.email,
    plan: ent.plan,
    active: ent.ok,
    entitlement: ent.reason,
    trialUntil: user.trialUntil || null,
    paidUntil: user.paidUntil || null,
    teamRepos: user.teamRepos || [],
    teamFeatures: teamFeatures(user)
  };
}

/** trial / pro / team 有效即可用 Pro 特性；匿名与过期不可。 */
function canUsePro(user, at) {
  return isActive(user, at).ok;
}

function canUseTeam(user, at) {
  return isActive(user, at).plan === 'team';
}

function teamFeatures(user, at) {
  const ok = canUseTeam(user, at);
  return {
    ok,
    items: TEAM_FEATURE_CATALOG.map((f) => Object.assign({}, f, { unlocked: ok && (f.ready || f.placeholder) }))
  };
}

module.exports = {
  TRIAL_DAYS,
  TEAM_FEATURE_CATALOG,
  trialUntilFrom,
  isActive,
  publicUser,
  canUsePro,
  canUseTeam,
  teamFeatures
};
