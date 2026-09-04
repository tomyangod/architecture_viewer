'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../../../lib/pro/store');
const { isActive } = require('../../../lib/pro/entitlement');
const { encrypt, decrypt } = require('../../../lib/pro/crypto');
const { runHostedCheck } = require('./host-drift');
const { sendWecom, assertNotifyUrl } = require('./notify');

const BLOCKED_PREFIXES = ['/etc', '/sys', '/proc', '/dev', '/private/etc'];

function localEnabled() {
  if (process.env.ARCH_PRO_LOCAL === '0') return false;
  if (process.env.ARCH_PRO_LOCAL === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

function minInterval() {
  if (process.env.NODE_ENV === 'test') return 1;
  return 5;
}

function resolveLocalRoot(rawPath) {
  if (!localEnabled()) {
    const err = new Error('本地检查仅在本机/内网网页开启。请设 ARCH_PRO_LOCAL=1，或在本机运行 npm run web');
    err.status = 403;
    throw err;
  }
  const input = String(rawPath || '').trim();
  if (!input) {
    const err = new Error('请填写项目文件夹路径');
    err.status = 400;
    throw err;
  }
  if (!path.isAbsolute(input)) {
    const err = new Error('请填写绝对路径，例如 /Users/你/项目');
    err.status = 400;
    throw err;
  }
  if (!fs.existsSync(input)) {
    const err = new Error('找不到这个文件夹');
    err.status = 400;
    throw err;
  }
  let resolved;
  try {
    resolved = fs.realpathSync(input);
  } catch {
    const err = new Error('无法读取该路径');
    err.status = 400;
    throw err;
  }
  if (!fs.statSync(resolved).isDirectory()) {
    const err = new Error('路径必须是文件夹，不是文件');
    err.status = 400;
    throw err;
  }
  const blocked = BLOCKED_PREFIXES.some((p) => resolved === p || resolved.startsWith(p + path.sep));
  if (blocked) {
    const err = new Error('不能检查系统目录');
    err.status = 400;
    throw err;
  }
  const root = process.env.ARCH_PRO_LOCAL_ROOT ? path.resolve(process.env.ARCH_PRO_LOCAL_ROOT) : '';
  if (root) {
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      const err = new Error('路径必须在允许的根目录内：' + root);
      err.status = 400;
      throw err;
    }
  }
  return resolved;
}

function parseInterval(raw) {
  if (raw === undefined || raw === null || raw === '') return 15;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error('自动检查间隔须为 0 或正整数分钟');
    err.status = 400;
    throw err;
  }
  if (n === 0) return 0;
  const min = minInterval();
  if (n < min) return min;
  return Math.min(Math.floor(n), 24 * 60);
}

function localPublic(row) {
  return {
    id: row.id,
    path: row.path,
    intervalMin: row.intervalMin,
    hasWecom: !!row.wecomEnc,
    lastOk: row.lastOk,
    lastAt: row.lastAt || null,
    lastMissing: row.lastMissing || 0,
    lastErrors: row.lastErrors || 0
  };
}

function upsertLocal(user, body) {
  const resolved = resolveLocalRoot(body.path);
  let intervalMin = parseInterval(body.intervalMin);
  let wecom = '';
  if (body.wecomWebhook) wecom = assertNotifyUrl(body.wecomWebhook);
  const active = isActive(user).ok;
  let limited = false;
  if (!active) {
    limited = intervalMin > 0 || !!wecom;
    intervalMin = 0;
    wecom = '';
  }
  const db = store.load();
  const exists = (db.locals || []).find((p) => p.userId === user.id && p.path === resolved);
  if (exists) {
    exists.intervalMin = intervalMin;
    if (active && body.wecomWebhook !== undefined) {
      exists.wecomEnc = wecom ? encrypt(wecom) : '';
    }
    store.save(db);
    store.track('local_update', { userId: user.id, path: resolved });
    return { rec: exists, limited };
  }
  if (!db.locals) db.locals = [];
  const rec = {
    id: store.id(),
    userId: user.id,
    path: resolved,
    intervalMin,
    wecomEnc: wecom ? encrypt(wecom) : '',
    createdAt: new Date().toISOString(),
    lastOk: null,
    lastAt: null,
    lastMissing: 0,
    lastErrors: 0
  };
  db.locals.push(rec);
  store.save(db);
  store.track('local_add', { userId: user.id, path: resolved });
  return { rec, limited };
}

function findOwned(db, user, id) {
  return (db.locals || []).find((p) => p.id === id && p.userId === user.id) || null;
}

async function runLocalCheck(user, rec, opts) {
  const notify = !!(opts && opts.notify);
  const check = runHostedCheck(rec.path, { repoLabel: rec.path });
  const db = store.load();
  const row = findOwned(db, user, rec.id);
  if (!row) {
    const err = new Error('本地项目未找到');
    err.status = 404;
    throw err;
  }
  row.lastOk = !!check.ok;
  row.lastAt = new Date().toISOString();
  row.lastMissing = ((check.drift && check.drift.missing) || []).length;
  row.lastErrors = ((check.protocol && check.protocol.errors) || []).length;
  db.events.unshift({
    id: store.id(),
    userId: user.id,
    localId: row.id,
    kind: 'local',
    ok: check.ok,
    label: path.basename(row.path),
    at: row.lastAt,
    missing: row.lastMissing,
    errors: row.lastErrors
  });
  db.events = db.events.slice(0, 200);
  store.save(db);
  store.track(check.ok ? 'local_ok' : 'local_red', { userId: user.id, path: row.path });

  let notified = false;
  let notifyError = null;
  if (notify && row.wecomEnc) {
    try {
      await sendWecom(decrypt(row.wecomEnc), check.markdown);
      notified = true;
    } catch (e) {
      notifyError = e.message;
    }
  }
  return { check, project: localPublic(row), notified, notifyError };
}

async function tickDueLocals() {
  const db = store.load();
  const now = Date.now();
  const due = (db.locals || []).filter((row) => {
    if (!row.intervalMin) return false;
    const owner = db.users.find((u) => u.id === row.userId);
    if (!isActive(owner).ok) return false;
    const last = Date.parse(row.lastAt || '') || 0;
    return now - last >= row.intervalMin * 60 * 1000;
  });
  const out = [];
  for (const row of due) {
    const owner = db.users.find((u) => u.id === row.userId);
    try {
      out.push(await runLocalCheck(owner, row, { notify: true }));
    } catch {
      /* skip one bad path */
    }
  }
  return out;
}

function startLocalTicker() {
  if (process.env.NODE_ENV === 'test') return null;
  if (!localEnabled()) return null;
  const ms = Number(process.env.ARCH_PRO_LOCAL_TICK_MS) || 60 * 1000;
  return setInterval(() => {
    tickDueLocals().catch(() => {});
  }, ms);
}

module.exports = {
  localEnabled,
  resolveLocalRoot,
  parseInterval,
  localPublic,
  upsertLocal,
  findOwned,
  runLocalCheck,
  tickDueLocals,
  startLocalTicker
};
