'use strict';

/**
 * 安装与激活指标聚合（W06-04 看板后端）。
 *
 * 数据源：
 *   1. npm downloads API — 累计 / 周 / 日下载量
 *   2. Pro store (.data/pro/store.json) — 用户 / 试用 / 付费 / 订单
 *   3. funnel.log — 注册 / 试用 / 登录 / 付费事件
 *   4. telemetry.log — CLI 活跃（默认关，开启后才有数据）
 *
 * 缓存 5 分钟，避免频繁打 npm API。
 * 所有输出均为匿名聚合，不含邮箱 / token / 路径。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const PKG = 'arch-viewer';
const NPM_FIRST_PUBLISH = '2026-09-01';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null; // { at, data }

// --- npm API ---

function npmGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: 'application/json', 'User-Agent': 'arch-viewer-metrics' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`npm API HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

/** 返回 { from, to } UTC 日期字符串，最近 N 天 */
function lastNDays(n) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (n - 1));
  return { from: isoDay(start), to: isoDay(end) };
}

/** 本周一 ~ 今天（UTC） */
function thisWeekRange() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const day = end.getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - mondayOffset);
  return { from: isoDay(start), to: isoDay(end) };
}

async function fetchNpmMetrics() {
  const daily30 = lastNDays(30);
  const week = thisWeekRange();
  const today = isoDay(new Date());

  const [totalPoint, weekPoint, dailyRange] = await Promise.all([
    npmGetJson(`https://api.npmjs.org/downloads/point/${NPM_FIRST_PUBLISH}:${today}/${PKG}`),
    npmGetJson(`https://api.npmjs.org/downloads/point/${week.from}:${week.to}/${PKG}`),
    npmGetJson(`https://api.npmjs.org/downloads/range/${daily30.from}:${daily30.to}/${PKG}`)
  ]);

  const daily = (dailyRange.downloads || []).map((d) => ({ day: d.day, downloads: d.downloads || 0 }));

  return {
    totalInstalls: totalPoint.downloads || 0,
    weeklyInstalls: weekPoint.downloads || 0,
    weekRange: week,
    daily,
    dailyRange: daily30
  };
}

// --- Pro store ---

function isSmokeEmail(email) {
  const e = String(email || '').toLowerCase();
  return (
    !e ||
    e.includes('example.com') ||
    e.includes('@test.') ||
    e.startsWith('smoke') ||
    e.startsWith('local-demo') ||
    e.startsWith('expired-') ||
    e.startsWith('pro-demo')
  );
}

function readProMetrics() {
  const storePath = path.join(ROOT, '.data', 'pro', 'store.json');
  if (!fs.existsSync(storePath)) {
    return { available: false, users: 0, trial: 0, pro: 0, team: 0, orders: 0, paidOrders: 0, revenueCents: 0, weeklyLogins: 0, weeklySignups: 0 };
  }

  let store;
  try {
    store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return { available: false, users: 0, trial: 0, pro: 0, team: 0, orders: 0, paidOrders: 0, revenueCents: 0, weeklyLogins: 0, weeklySignups: 0 };
  }

  const users = store.users || [];
  const realUsers = users.filter((u) => !isSmokeEmail(u.email));
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;

  let trial = 0;
  let pro = 0;
  let team = 0;
  for (const u of realUsers) {
    if (u.plan === 'team') team++;
    else if (u.plan === 'pro') pro++;
    else if (u.plan === 'trial') {
      // trial 过期后不算活跃 trial
      if (u.trialUntil && new Date(u.trialUntil).getTime() > now) trial++;
    }
  }

  const orders = store.orders || [];
  const paidOrders = orders.filter((o) => o.status === 'paid' || o.status === 'completed');
  const revenueCents = paidOrders.reduce((sum, o) => sum + (Number(o.amountCents) || 0), 0);

  // 本周登录 / 注册（从 events 或 sessions 粗算）
  let weeklyLogins = 0;
  let weeklySignups = 0;
  const events = store.events || [];
  for (const ev of events) {
    const ts = ev.at ? new Date(ev.at).getTime() : 0;
    if (ts < weekAgo) continue;
    if (ev.kind === 'login' || ev.kind === 'login_code_verified') weeklyLogins++;
    if (ev.kind === 'signup') weeklySignups++;
  }

  return {
    available: true,
    users: realUsers.length,
    trial,
    pro,
    team,
    orders: orders.length,
    paidOrders: paidOrders.length,
    revenueCents,
    weeklyLogins,
    weeklySignups
  };
}

// --- Funnel events ---

function readFunnelMetrics() {
  const funnelPath = path.join(ROOT, '.data', 'pro', 'funnel.log');
  const counts = { signup: 0, trial: 0, login: 0, paywall_shown: 0, pay: 0, checkout: 0, team_order: 0 };
  const weekly = { signup: 0, trial: 0, login: 0, paywall_shown: 0, pay: 0, checkout: 0, team_order: 0 };

  if (!fs.existsSync(funnelPath)) {
    return { available: false, total: counts, weekly };
  }

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const lines = fs.readFileSync(funnelPath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const name = row.event;
    if (!name || !(name in counts)) continue;
    counts[name]++;
    const ts = row.ts ? new Date(row.ts).getTime() : 0;
    if (ts >= weekAgo) weekly[name]++;
  }

  return { available: true, total: counts, weekly };
}

// --- Telemetry (CLI activity, opt-in) ---

function telemetryPath() {
  if (process.env.ARCH_CONFIG_DIR) {
    return path.join(process.env.ARCH_CONFIG_DIR, 'telemetry.log');
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'arch-viewer', 'telemetry.log');
  }
  return path.join(os.homedir(), '.config', 'arch-viewer', 'telemetry.log');
}

function readTelemetryMetrics() {
  const logFile = telemetryPath();
  if (!fs.existsSync(logFile)) {
    return { available: false, weeklyCommands: 0, weeklyGenerate: 0, weeklyActiveDays: 0, note: '遥测默认关闭' };
  }

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  let commands = 0;
  let generate = 0;
  const days = new Set();

  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = row.ts ? new Date(row.ts).getTime() : 0;
    if (ts < weekAgo) continue;
    if (row.event === 'cli_command') {
      commands++;
      const day = (row.ts || '').slice(0, 10);
      if (day) days.add(day);
      const cmd = String(row.command || '');
      if (cmd === 'generate' || cmd.startsWith('session')) generate++;
    }
  }

  return {
    available: true,
    weeklyCommands: commands,
    weeklyGenerate: generate,
    weeklyActiveDays: days.size,
    note: '仅本机开启遥测的样本'
  };
}

// --- Aggregate ---

async function getMetrics(force) {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const [npm, pro, funnel, telemetry] = await Promise.all([
    fetchNpmMetrics().catch((err) => ({ error: err.message, totalInstalls: 0, weeklyInstalls: 0, daily: [] })),
    Promise.resolve(readProMetrics()),
    Promise.resolve(readFunnelMetrics()),
    Promise.resolve(readTelemetryMetrics())
  ]);

  // 转化漏斗
  const weeklyInstalls = npm.weeklyInstalls || 0;
  const weeklySignups = funnel.weekly.signup || pro.weeklySignups || 0;
  const weeklyTrial = funnel.weekly.trial || 0;
  const weeklyPay = funnel.weekly.pay || pro.paidOrders || 0;

  const funnel_pct = {
    installToSignup: weeklyInstalls > 0 ? Math.round((weeklySignups / weeklyInstalls) * 1000) / 10 : null,
    signupToTrial: weeklySignups > 0 ? Math.round((weeklyTrial / weeklySignups) * 1000) / 10 : null,
    trialToPay: weeklyTrial > 0 ? Math.round((weeklyPay / weeklyTrial) * 1000) / 10 : null
  };

  const data = {
    generatedAt: new Date().toISOString(),
    cached: false,
    npm,
    pro,
    funnel: { events: funnel, conversion: funnel_pct },
    telemetry,
    kpi: {
      totalInstalls: npm.totalInstalls || 0,
      weeklyInstalls,
      weeklyActive: telemetry.available ? telemetry.weeklyActiveDays : 0,
      proUsers: pro.users,
      activeTrial: pro.trial,
      paidUsers: pro.pro + pro.team,
      paidOrders: pro.paidOrders,
      revenueYuan: Math.round(pro.revenueCents / 100 * 100) / 100
    }
  };

  cache = { at: Date.now(), data };
  return data;
}

module.exports = { getMetrics, isSmokeEmail, lastNDays, thisWeekRange };
