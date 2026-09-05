#!/usr/bin/env node
/**
 * 拉取 arch-viewer 安装/激活指标摘要，供周五写入 pm/metrics.md / 周报 §六。
 * 不写库、不改文件；stdout 给人眼与拷贝。
 *
 *   node pm/scripts/metrics-pull.mjs
 *   node pm/scripts/metrics-pull.mjs --from 2026-09-01 --to 2026-09-07
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG = 'arch-viewer';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') out.from = argv[++i];
    else if (argv[i] === '--to') out.to = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

/** 默认：本周一～今天（UTC）；若今天早于周一则用过去 7 天 */
function defaultRange() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const day = end.getUTCDay(); // 0 Sun
  const mondayOffset = day === 0 ? 6 : day - 1;
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - mondayOffset);
  return { from: isoDay(start), to: isoDay(end) };
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: 'application/json', 'User-Agent': 'arch-viewer-metrics-pull' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${url}: ${text.slice(0, 200)}`));
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

function telemetryPath() {
  if (process.env.ARCH_CONFIG_DIR) {
    return path.join(process.env.ARCH_CONFIG_DIR, 'telemetry.log');
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'arch-viewer', 'telemetry.log');
  }
  return path.join(os.homedir(), '.config', 'arch-viewer', 'telemetry.log');
}

function summarizeTelemetry(logFile, from, to) {
  if (!fs.existsSync(logFile)) {
    return { enabledSample: false, commands: 0, generate: 0, uniqueDays: 0, note: '无本地 telemetry.log（默认关或未开启过）' };
  }
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
    const ts = (row.ts || '').slice(0, 10);
    if (!ts || ts < from || ts > to) continue;
    if (row.event === 'cli_command') {
      commands++;
      days.add(ts);
      const cmd = String(row.command || '');
      if (cmd === 'generate' || cmd.startsWith('session')) generate++;
    }
  }
  return {
    enabledSample: true,
    commands,
    generate,
    uniqueDays: days.size,
    note: '仅本机开启遥测的样本，非全网周活跃'
  };
}

function countProRealUsers(storePath) {
  if (!fs.existsSync(storePath)) {
    return { users: 0, note: '无 .data/pro/store.json' };
  }
  let store;
  try {
    store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return { users: 0, note: 'store.json 无法解析' };
  }
  const users = store.users || [];
  const real = users.filter((u) => {
    const e = String(u.email || '').toLowerCase();
    return e && !e.includes('example.com') && !e.includes('@test.') && !e.startsWith('smoke') && !e.startsWith('local-demo') && !e.startsWith('expired-') && !e.startsWith('pro-demo');
  });
  return {
    users: real.length,
    totalIncludingSmoke: users.length,
    note: real.length ? '已排除常见 smoke 邮箱' : '当前库内多为测试账号，Pro 登录记 0'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node pm/scripts/metrics-pull.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
    process.exit(0);
  }
  const range = args.from && args.to ? { from: args.from, to: args.to } : defaultRange();
  const pointUrl = `https://api.npmjs.org/downloads/point/${range.from}:${range.to}/${PKG}`;
  const allTimeUrl = `https://api.npmjs.org/downloads/point/2026-09-01:${range.to}/${PKG}`;
  const rangeUrl = `https://api.npmjs.org/downloads/range/${range.from}:${range.to}/${PKG}`;

  const [point, allTime, daily] = await Promise.all([
    getJson(pointUrl),
    getJson(allTimeUrl),
    getJson(rangeUrl)
  ]);

  const tel = summarizeTelemetry(telemetryPath(), range.from, range.to);
  const pro = countProRealUsers(path.join(ROOT, '.data', 'pro', 'store.json'));

  console.log(`# metrics-pull  ${new Date().toISOString()}`);
  console.log(`package: ${PKG}`);
  console.log(`range:   ${range.from} → ${range.to} (UTC)`);
  console.log('');
  console.log('## npm');
  console.log(`周下载（区间合计）: ${point.downloads ?? 0}`);
  console.log(`累计（自 2026-09-01）: ${allTime.downloads ?? 0}`);
  if (daily.downloads && daily.downloads.length) {
    for (const d of daily.downloads) {
      if (d.downloads) console.log(`  ${d.day}: ${d.downloads}`);
    }
  }
  console.log('');
  console.log('## 遥测（本机样本）');
  console.log(JSON.stringify(tel));
  console.log('');
  console.log('## Pro 账号（本机 store，生产需换路径）');
  console.log(JSON.stringify(pro));
  console.log('');
  console.log('## 建议写入 pm/metrics.md 的一行（人工确认后粘贴）');
  console.log(
    `| （周次） | ${allTime.downloads ?? 0} | ${point.downloads ?? 0} | ${tel.enabledSample ? tel.uniqueDays : 0}* | ${tel.enabledSample ? tel.generate : 0}* | ${pro.users} |  | 0 | 0 | npm ${range.from}～${range.to}；*${tel.note}；Pro ${pro.note} |`
  );
  console.log('');
  console.log('台账: pm/metrics.md ｜ 周报引用: pm/scripts/wbs-report.mjs §六');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
