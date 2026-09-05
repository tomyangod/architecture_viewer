'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

function dataDir() {
  return process.env.ARCH_PRO_DATA || path.join(ROOT, '.data', 'pro');
}

function storePath() {
  return path.join(dataDir(), 'store.json');
}

function funnelPath() {
  return path.join(dataDir(), 'funnel.log');
}

function empty() {
  return { users: [], sessions: [], repos: [], locals: [], events: [], loginCodes: [], orders: [] };
}

function load() {
  const p = storePath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Object.assign(empty(), raw);
    }
  } catch {
    /* corrupt → empty */
  }
  return empty();
}

function save(db) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = storePath() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, storePath());
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function track(event, payload) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), event }, payload || {})) + '\n';
    fs.appendFileSync(funnelPath(), line);
  } catch {
    /* ignore */
  }
  // 镜像到 CLI 遥测（默认关）；漏斗事件名加 funnel_ 前缀，去掉邮箱
  try {
    const telemetry = require('../telemetry');
    const safe = {};
    const src = payload || {};
    for (const k of Object.keys(src)) {
      if (k === 'email' || k === 'userId' || k === 'token' || k === 'path') continue;
      const v = src[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
    }
    telemetry.track('funnel_' + String(event), safe);
  } catch {
    /* ignore */
  }
}

module.exports = { load, save, id, dataDir, storePath, track, empty };
