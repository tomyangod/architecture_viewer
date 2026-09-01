#!/usr/bin/env node
'use strict';

/**
 * Usage7 + path-truth gate + review loop.
 *   DEEPSEEK_API_KEY=... node eval/orch/usage7-gated.js [repoName ...]
 *
 * Writes /tmp/arch-orch/out/usage7g-<short>/block-diagram.md
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildTree, lintBlockDiagram } = require('./lib');

const AV = path.resolve(__dirname, '../..');
const REPOS_ROOT = '/tmp/arch-orch/repos';
const OUT = '/tmp/arch-orch/out';
const ALL = [
  { name: 'changedetection.io', short: 'changedetection' },
  { name: 'listmonk', short: 'listmonk' },
  { name: 'uptime-kuma', short: 'uptime-kuma' },
  { name: 'memos', short: 'memos' },
  { name: 'umami', short: 'umami' },
  // edge-case 批（网关/无 SPA/动态入口）
  { name: 'ntfy', short: 'ntfy' },
  { name: 'vaultwarden', short: 'vaultwarden' },
  { name: 'zigbee2mqtt', short: 'zigbee2mqtt' },
  { name: 'caddy', short: 'caddy' }
];

const DSH_CANDIDATES = [
  process.env.DSH_BIN,
  '/Users/yanheyang/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh'
].filter(Boolean);

function findDsh() {
  for (const p of DSH_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return 'npx';
}

function lintMd(repoRoot, mdPath) {
  const md = fs.readFileSync(mdPath, 'utf8');
  const tree = buildTree(repoRoot);
  return lintBlockDiagram(md, tree);
}

function dsh(cwd, task, logPath) {
  const bin = findDsh();
  const args = bin === 'npx'
    ? ['--yes', '@deepseek-ai/dsh', '--profile', 'headless', task]
    : ['--profile', 'headless', task];
  const r = spawnSync(bin, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  const text = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(logPath, text);
  return { code: r.status, text };
}

function initKit(repoRoot) {
  spawnSync('node', [path.join(AV, 'lib/cli.js'), 'init', repoRoot], {
    encoding: 'utf8'
  });
}

function reviewPrompt(missing, issues) {
  return [
    'A deterministic path-truth gate FAILED on architecture_viewer/block-diagram.md.',
    'These <small> tokens look like paths but DO NOT exist in this repository file tree:',
    ...missing.map((p) => '  - ' + p),
    '',
    'Other lint issues:',
    ...issues.filter((i) => !i.startsWith('路径在文件树中不存在')).slice(0, 8).map((i) => '  - ' + i),
    '',
    'Fix ONLY architecture_viewer/block-diagram.md:',
    '1. Remove or rewrite every failing token. Tech names must have NO slash (e.g. Playwright, PostgreSQL).',
    '2. Every remaining path-like token must exist (verify with test -e or ls).',
    '3. Keep the layered flowchart style, Chinese edge labels, and a second 子图.',
    '4. Do not invent new filenames.',
    '5. Print LAYERS=... NODES=... DONE when finished.'
  ].join('\n');
}

function runOne(spec) {
  const root = path.join(REPOS_ROOT, spec.name);
  const dest = path.join(OUT, 'usage7g-' + spec.short);
  const kitMd = path.join(root, 'architecture_viewer', 'block-diagram.md');
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(root)) throw new Error('missing repo ' + root);

  console.log('\n======== USAGE7G', spec.name, '========');
  initKit(root);
  const prompt = fs.readFileSync(path.join(__dirname, 'USAGE7-DSH-PROMPT.txt'), 'utf8');

  let rounds = 0;
  let last = null;
  dsh(root, prompt, path.join(dest, 'run1.log'));
  rounds++;
  if (!fs.existsSync(kitMd)) throw new Error('no block-diagram after dsh');
  last = lintMd(root, kitMd);
  console.log('round1 hallu=', last.metrics.幻觉路径数, last.missingPaths);

  for (let i = 2; i <= 3 && last.missingPaths.length; i++) {
    const rp = reviewPrompt(last.missingPaths, last.issues);
    dsh(root, rp, path.join(dest, 'run' + i + '.log'));
    rounds++;
    last = lintMd(root, kitMd);
    console.log('round' + i, 'hallu=', last.metrics.幻觉路径数, last.missingPaths);
  }

  fs.copyFileSync(kitMd, path.join(dest, 'block-diagram.md'));
  fs.writeFileSync(
    path.join(dest, 'gate.json'),
    JSON.stringify({ rounds, hallu: last.metrics.幻觉路径数, missing: last.missingPaths, issues: last.issues, metrics: last.metrics }, null, 2)
  );
  return { spec, rounds, lint: last };
}

function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('Need DEEPSEEK_API_KEY');
    process.exit(2);
  }
  const want = process.argv.slice(2);
  const list = want.length
    ? ALL.filter((s) => want.includes(s.name) || want.includes(s.short))
    : ALL;
  const results = list.map(runOne);
  console.log('\n===== GATE SUMMARY =====');
  for (const r of results) {
    console.log(r.spec.name, 'rounds=' + r.rounds, 'hallu=' + r.lint.metrics.幻觉路径数);
  }
}

if (require.main === module) main();
module.exports = { runOne, lintMd };
