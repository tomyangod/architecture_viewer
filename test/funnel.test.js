'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-funnel-cfg-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-funnel-data-'));
const teleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-funnel-tele-'));
process.env.ARCH_CONFIG_DIR = teleDir;
process.env.ARCH_PRO_DATA = dataDir;
process.env.ARCH_TELEMETRY = '1';
process.env.NODE_ENV = 'test';
delete process.env.DO_NOT_TRACK;
delete process.env.ARCH_TELEMETRY_OFF;

const store = require('../lib/pro/store');
const funnel = require('../lib/pro/funnel');
const authClient = require('../lib/pro/auth-client');

describe('W09-01 funnel + trial', () => {
  beforeEach(() => {
    fs.writeFileSync(store.storePath(), JSON.stringify(store.empty(), null, 2));
    const tele = path.join(teleDir, 'telemetry.log');
    if (fs.existsSync(tele)) fs.unlinkSync(tele);
  });

  it('auth-client exposes startTrial and trial string for TRIAL_OK', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pro', 'auth-client.js'), 'utf8');
    assert.match(src, /trial/);
    assert.equal(typeof authClient.startTrial, 'function');
    const ent = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pro', 'entitlement.js'), 'utf8');
    assert.match(ent, /trial/);
  });

  it('paywall_shown lands in funnel.log and telemetry when enabled', () => {
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      const shown = funnel.maybePaywallAfterValueMoment({
        findingsCount: 2,
        level: 'high',
        reason: 'session_risk'
      });
      assert.equal(shown, true);
    } finally {
      console.log = orig;
    }
    assert.match(logs.join('\n'), /Pro 提示/);
    assert.match(logs.join('\n'), /auth login/);
    const funnelLog = fs.readFileSync(path.join(dataDir, 'funnel.log'), 'utf8');
    assert.match(funnelLog, /"event":"paywall_shown"/);
    const tele = fs.readFileSync(path.join(teleDir, 'telemetry.log'), 'utf8');
    assert.match(tele, /funnel_paywall_shown/);
  });

  it('first passwordless login creates trial and funnel trial event', async () => {
    const t = authClient.transport();
    const req = await t.requestCode('funnel-trial@example.com');
    assert.ok(req.devCode);
    const out = await authClient.loginFlow({ email: 'funnel-trial@example.com', code: req.devCode });
    assert.equal(out.entitlement, 'trial');
    assert.ok(out.trialUntil);
    const funnelLog = fs.readFileSync(path.join(dataDir, 'funnel.log'), 'utf8');
    assert.match(funnelLog, /"event":"trial"/);
    assert.match(funnelLog, /"event":"login"/);
  });

  it('no paywall when no findings and no drift', () => {
    const shown = funnel.maybePaywallAfterValueMoment({
      findingsCount: 0,
      driftMissing: 0,
      level: 'none'
    });
    assert.equal(shown, false);
  });
});
