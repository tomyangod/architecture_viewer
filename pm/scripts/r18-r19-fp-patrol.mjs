#!/usr/bin/env node
/**
 * R18/R19 FP 巡检：回放近 N 日真实 commit（parent→commit）当虚拟 PR。
 * 有 R18/R19 finding 或可疑 addedThrows 时 stdout 摘要并以 exit 2 提示需人工看。
 *
 *   node pm/scripts/r18-r19-fp-patrol.mjs [--days 3] [--out pm/reports/...]
 *   AV_FP_POM_REPO=/path/to/publicopinionmonitor_v2 可选覆盖 POM 路径
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AV_ROOT = path.resolve(__dirname, '../..');

const { scanGitTreeish } = require('../../lib/session-baseline');
const { diffGraphs } = require('../../lib/diff-graph');
const { evaluateRisk } = require('../../lib/risk-rules');
const { attachCallEdges } = require('../../lib/extract-graph');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function runGit(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000 });
  return {
    status: r.status,
    stdout: String(r.stdout || '').trim(),
    stderr: String(r.stderr || '').trim()
  };
}

function listCommits(repo, sinceDays) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const r = runGit(repo, [
    'log', `--since=${since}`, '--pretty=format:%H%x09%s', '--no-merges', '-n', '40'
  ]);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [sha, ...rest] = line.split('\t');
    return { sha, subject: rest.join('\t') };
  }).filter((c) => c.sha && !/^(docs?|chore\(docs\)|readme)/i.test(c.subject));
}

function replayCommit(repo, sha) {
  const t0 = Date.now();
  const base = scanGitTreeish(repo, `${sha}^`, { overlay: false });
  const head = scanGitTreeish(repo, sha, { overlay: false });
  if (base.error || head.error) {
    return {
      sha,
      error: (base.message || head.message || 'scan failed'),
      ms: Date.now() - t0
    };
  }
  attachCallEdges(base.graph, {});
  attachCallEdges(head.graph, {});
  const diff = diffGraphs(base.graph, head.graph);
  const findings = evaluateRisk(diff, head.graph, base.graph, null, {});
  const r18 = findings.filter((f) => f.rule === 'enum-exhaustiveness');
  const r19 = findings.filter((f) => f.rule === 'exception-contract-drift');
  const addedThrows = (diff.behaviorChanges || [])
    .filter((c) => (c.addedThrows || []).length)
    .map((c) => ({ id: c.id, throws: c.addedThrows, path: c.path }));
  return {
    sha: sha.slice(0, 7),
    fullSha: sha,
    ms: Date.now() - t0,
    r18: r18.map((f) => f.message),
    r19: r19.map((f) => f.message),
    addedThrows,
    fired: r18.length + r19.length
  };
}

function main() {
  const days = Number(arg('--days', '3')) || 3;
  const out = arg('--out', path.join(AV_ROOT, 'pm/reports', `r18-r19-fp-patrol-${new Date().toISOString().slice(0, 10)}.json`));
  const pom = process.env.AV_FP_POM_REPO
    || path.resolve(AV_ROOT, '../publicopinionmonitor_v2');
  const repos = [
    { name: 'architecture_viewer', root: AV_ROOT },
    ...(fs.existsSync(pom) ? [{ name: 'publicopinionmonitor_v2', root: pom }] : [])
  ];

  const results = [];
  for (const repo of repos) {
    const commits = listCommits(repo.root, days).slice(0, 8);
    for (const c of commits) {
      const row = replayCommit(repo.root, c.sha);
      results.push({
        repo: repo.name,
        subject: c.subject,
        dateHint: days,
        ...row
      });
      const tag = row.error ? 'ERR' : (row.fired ? 'HIT' : (row.addedThrows && row.addedThrows.length ? 'THROW' : 'ok'));
      console.log(`[${tag}] ${repo.name} ${row.sha || c.sha.slice(0, 7)} ${c.subject.slice(0, 60)}`);
    }
  }

  const fired = results.filter((r) => r.fired > 0);
  const throwsSilent = results.filter((r) => !r.fired && (r.addedThrows || []).length);
  const payload = {
    generatedAt: new Date().toISOString(),
    days,
    repos: repos.map((r) => r.name),
    summary: {
      commits: results.length,
      r18_r19_fired: fired.length,
      addedThrows_silent: throwsSilent.length
    },
    results,
    needsHuman: fired.length > 0 || throwsSilent.length > 0
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`wrote ${out}`);
  console.log(JSON.stringify(payload.summary));
  if (payload.needsHuman) {
    console.log('NEEDS_HUMAN: R18/R19 finding 或静默 addedThrows — 请人工标 FP/TN/召回缺口');
    process.exit(2);
  }
}

main();
