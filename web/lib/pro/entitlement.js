'use strict';

const TRIAL_DAYS = 7;

function now() {
  return Date.now();
}

function trialUntilFrom(createdAt) {
  const t = Date.parse(createdAt) || now();
  return new Date(t + TRIAL_DAYS * 24 * 3600 * 1000).toISOString();
}

function isActive(user, at) {
  const ts = at || now();
  if (!user) return { ok: false, reason: 'anonymous', plan: 'none' };
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
    paidUntil: user.paidUntil || null
  };
}

module.exports = { TRIAL_DAYS, trialUntilFrom, isActive, publicUser };
