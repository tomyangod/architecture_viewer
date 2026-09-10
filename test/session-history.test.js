'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendSessionHistory,
  readSessionHistory,
  formatHistoryTable
} = require('../lib/session-report');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-history-'));
  return dir;
}

const rec = (risk, n) => ({
  baseline: { fingerprint: 'base-' + n },
  current: { fingerprint: 'head-' + n, stats: { files: 10 + n } },
  diff: { summary: { addedNodes: n, removedNodes: 0, modifiedNodes: 1 } },
  riskSummary: { level: risk, counts: { high: 0, medium: risk === 'medium' ? 1 : 0, low: 0, info: 0 } }
});

test('W14-06: two appends → two JSONL lines with correct fields', () => {
  const repo = tmpRepo();
  assert.strictEqual(appendSessionHistory(repo, rec('none', 1)), true);
  assert.strictEqual(appendSessionHistory(repo, rec('medium', 2)), true);

  const lines = fs.readFileSync(path.join(repo, '.av', 'session-history.jsonl'), 'utf8')
    .trim().split('\n');
  assert.strictEqual(lines.length, 2);
  const r2 = JSON.parse(lines[1]);
  assert.strictEqual(r2.risk, 'medium');
  assert.strictEqual(r2.added, 2);
  assert.strictEqual(r2.files, 12);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r2.ts));
});

test('W14-06: readSessionHistory respects limit and keeps chronological order', () => {
  const repo = tmpRepo();
  for (let i = 1; i <= 3; i++) appendSessionHistory(repo, rec('none', i));
  const all = readSessionHistory(repo, 0);
  assert.strictEqual(all.length, 3);
  const last = readSessionHistory(repo, 1);
  assert.strictEqual(last.length, 1);
  assert.strictEqual(last[0].added, 3);
});

test('W14-06: missing file and corrupt lines → empty / skipped', () => {
  assert.deepStrictEqual(readSessionHistory(tmpRepo()), []);
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, '.av'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.av', 'session-history.jsonl'), '{not json\n\n');
  appendSessionHistory(repo, rec('none', 1));
  const records = readSessionHistory(repo);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].added, 1);
});

test('W14-06: formatHistoryTable empty + populated', () => {
  assert.match(formatHistoryTable([]), /暂无历史记录/);
  const table = formatHistoryTable([
    { ts: '2026-09-06T14:35:00.000Z', risk: 'high', findings: { high: 1, medium: 0, low: 0, info: 0 }, added: 2, removed: 1, modified: 0, files: 11 }
  ]);
  assert.match(table, /HIGH/);
  assert.match(table, /1\/0\/0\/0/);
  assert.match(table, /11 文件/);
});
