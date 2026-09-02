#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  initKit,
  generateForRepo,
  generateForRepoAsync,
  generateToDir,
  checkKit,
  findKitDir,
  scan,
  agentPrompt,
  productRoot
} = require('./index');

const { buildGraph, extractGraphTo } = require('./extract-graph');
const { diffGraphs, formatDiffText } = require('./diff-graph');
const { evaluateRisk, summarizeFindings } = require('./risk-rules');
const { generateReport } = require('./session-report');
const { computeImpact, formatImpactText, aggregateImpact } = require('./impact');
const { formatPullRequestComment, postPullRequestComment } = require('./pr-comment');
const workspace = require('./workspace');

function help() {
  console.log(`Architecture Viewer CLI — Community

Usage:
  arch-viewer init [repo] [--dir architecture_viewer]
  arch-viewer generate [repo] [--dir architecture_viewer] [--refine | --skeleton]
  arch-viewer check [kit-or-repo] [--drift] [--filled] [--repo <root>]
  arch-viewer prompt [repo]
  arch-viewer eval [--config eval/repos.json]

  arch-viewer extract [repo] [--out graph.json]
  arch-viewer diff <base-dir> <head-dir> [--json] [--all]
  arch-viewer impact <base-dir> <head-dir> [--json] [--open]
  arch-viewer pr-comment <base-dir> <head-dir> [--post]
  arch-viewer session start [repo]
  arch-viewer session report [repo] [--all] [--open]

  arch-viewer workspace add <repo> [--name id] [--config f]
  arch-viewer workspace list [--config f]
  arch-viewer workspace remove <id|path> [--config f]
  arch-viewer workspace report [--config f] [--json] [--open]

  diff/session report 默认只显示高信号变更（新增/删除/修改/违规/依赖关系），
  归属关系（declared-in/defined-in）折叠为计数；加 --all 显示全部。

Generate:
  (default)   骨架图 — 扫描拼模板，秒级，无需 API Key
  --refine    精修 — LLM 出图 + 结构闸门（需 DEEPSEEK_API_KEY）
  --skeleton  强制骨架（即使已配置 Key）

  export DEEPSEEK_API_KEY=sk-...
  arch-viewer generate ./your-repo --refine
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a === '--repo' || a === '--config' || a === '--out' || a === '--name') {
      out[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) {
      out[a.slice(2)] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Fire-and-forget "open in default browser"; never blocks or fails the CLI.
function openInBrowser(filePath) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'explorer.exe'
    : 'xdg-open';
  try {
    const child = spawn(cmd, [filePath], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // headless / no browser — user can still open the file manually
  }
}

function formatFindingsText(findings) {
  if (!findings || findings.length === 0) return '';
  const lines = ['--- 风险发现 ---'];
  for (const f of findings) {
    const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : f.severity === 'low' ? '🔵' : '⚪';
    lines.push(`  ${icon} [${f.severity.toUpperCase()}] ${f.title}: ${f.message}`);
    if (f.detail) lines.push(`     ${f.detail}`);
  }
  return lines.join('\n');
}

function printIssues(result) {
  for (const e of result.protocol.errors) console.error('ERROR  ' + e);
  for (const w of result.protocol.warnings) console.warn('WARN   ' + w);
  if (result.drift && result.drift.missing && result.drift.missing.length) {
    for (const m of result.drift.missing) {
      console.error(`DRIFT  ${m.kind} "${m.label}" (${m.term}) not found in diagrams`);
    }
  }
}

function loadEvalConfig(configPath) {
  const p = path.resolve(configPath);
  const spec = JSON.parse(fs.readFileSync(p, 'utf8'));
  return spec.repos.map((r) => ({
    id: r.id,
    path: path.resolve(path.dirname(p), r.path)
  }));
}

function runEval(configPath) {
  const repos = loadEvalConfig(configPath);
  const outRoot = path.join(productRoot(), 'eval', 'out');
  fs.mkdirSync(outRoot, { recursive: true });
  const rows = [];
  for (const r of repos) {
    const row = { id: r.id, path: r.path, exists: fs.existsSync(r.path) };
    if (!row.exists) {
      row.status = 'SKIP';
      row.reason = 'path not found';
      rows.push(row);
      continue;
    }
    const dest = path.join(outRoot, r.id);
    fs.mkdirSync(dest, { recursive: true });
    const inventory = scan(r.path);
    fs.writeFileSync(path.join(dest, 'inventory.json'), JSON.stringify(inventory, null, 2));
    const result = generateToDir(r.path, dest);
    row.status = result.protocol.ok && result.drift.ok ? 'PASS' : 'FAIL';
    row.errors = result.protocol.errors.length;
    row.warnings = result.protocol.warnings.length;
    row.driftMissing = result.drift.missing.length;
    row.modules = inventory.modules.map((m) => m.label).join(', ');
    row.services = inventory.services.map((s) => s.label).join(', ');
    row.title = inventory.title;
    row.fingerprint = inventory.fingerprint;
    rows.push(row);
    if (row.status === 'FAIL') printIssues(result);
  }
  const md = [
    '# Generate quality eval',
    '',
    '| Repo | Status | Errors | Drift | Title | Modules |',
    '|------|--------|--------|-------|-------|---------|',
    ...rows.map((r) => `| ${r.id} | ${r.status}${r.reason ? ' (' + r.reason + ')' : ''} | ${r.errors ?? '-'} | ${r.driftMissing ?? '-'} | ${r.title || ''} | ${r.modules || ''} |`),
    '',
    'Outputs written only to `eval/out/<id>/` (does not overwrite diagrams in the real repos).',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(productRoot(), 'eval', 'REPORT.md'), md);
  console.log(md);
  const failed = rows.filter((r) => r.status === 'FAIL');
  const ran = rows.filter((r) => r.status !== 'SKIP');
  return { rows, failed, ran };
}

function printGenerateResult(r) {
  const engine = r.engine === 'llm' ? '精修 (refine)' : '骨架 (skeleton)';
  console.log('Mode: ' + engine);
  if (r.fallback) {
    console.warn('Fell back to skeleton: no DEEPSEEK_API_KEY');
  }
  if (r.model) console.log('Model: ' + r.model);
  console.log('Generated ' + r.written.length + ' diagrams in ' + r.kitDir);
  console.log('Inventory: ' + r.inventory.title + ' [' + r.inventory.fingerprint + ']');
  printIssues({ protocol: r.protocol, drift: r.drift });
  return r.protocol.ok && r.drift.ok ? 0 : 1;
}

function wantsRefine(args) {
  return !!(args.refine || args.llm);
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) {
    help();
    return 0;
  }
  if (cmd === 'init') {
    const repo = args._[1] || process.cwd();
    const r = initKit(repo, args.dir);
    console.log('Initialized kit at ' + r.dest);
    console.log('Copied: ' + r.copied.join(', '));
    return 0;
  }
  if (cmd === 'generate') {
    if (wantsRefine(args) && args.skeleton) {
      console.error('Use either --refine or --skeleton, not both.');
      return 2;
    }
    const repo = args._[1] || process.cwd();
    if (wantsRefine(args)) {
      const r = await generateForRepoAsync(repo, args.dir, { mode: 'llm', strict: true });
      return printGenerateResult(r);
    }
    const r = generateForRepo(repo, args.dir);
    r.engine = 'skeleton';
    r.fallback = false;
    return printGenerateResult(r);
  }
  if (cmd === 'check') {
    const target = path.resolve(args._[1] || process.cwd());
    const kitDir = fs.existsSync(path.join(target, 'architecture_visualized.html'))
      ? target
      : (findKitDir(target) || target);
    const result = checkKit(kitDir, {
      requireFilled: !!args.filled,
      drift: !!args.drift,
      repo: args.repo || undefined
    });
    printIssues(result);
    if (result.ok) console.log('OK  ' + kitDir);
    return result.ok ? 0 : 1;
  }
  if (cmd === 'prompt') {
    const repo = args._[1] || process.cwd();
    process.stdout.write(agentPrompt(path.resolve(repo), args.dir) + '\n');
    return 0;
  }
  if (cmd === 'eval') {
    const cfg = args.config || path.join(productRoot(), 'eval', 'repos.json');
    const r = runEval(cfg);
    return r.failed.length ? 1 : 0;
  }
  if (cmd === 'extract') {
    const repo = path.resolve(args._[1] || process.cwd());
    const outPath = args.out ? path.resolve(args.out) : null;
    const graph = extractGraphTo(repo, outPath);
    console.log(`Extracted: ${graph.stats.files} files, ${graph.stats.types} types, ${graph.stats.nodes} nodes, ${graph.stats.edges} edges, ${graph.stats.externalPackages} external deps`);
    console.log(`Fingerprint: ${graph.fingerprint}`);
    if (outPath) console.log('Written to: ' + outPath);
    else console.log(JSON.stringify(graph, null, 2));
    return 0;
  }
  if (cmd === 'diff') {
    const baseDir = args._[1];
    const headDir = args._[2];
    if (!baseDir || !headDir) {
      console.error('Usage: arch-viewer diff <base-dir> <head-dir>');
      return 2;
    }
    const baseGraph = buildGraph(path.resolve(baseDir));
    const headGraph = buildGraph(path.resolve(headDir));
    const diff = diffGraphs(baseGraph, headGraph);
    if (args.json) {
      console.log(JSON.stringify(diff, null, 2));
    } else {
      console.log(formatDiffText(diff, { all: !!args.all }));
      const diffFindings = evaluateRisk(diff, headGraph, baseGraph, computeImpact(diff, baseGraph, headGraph));
      const diffFindingsText = formatFindingsText(diffFindings);
      if (diffFindingsText) console.log('\n' + diffFindingsText);
      const impactText = formatImpactText(computeImpact(diff, baseGraph, headGraph));
      if (impactText) console.log('\n' + impactText);
    }
    return 0;
  }
  if (cmd === 'impact') {
    const baseDir = args._[1];
    const headDir = args._[2];
    if (!baseDir || !headDir) {
      console.error('Usage: arch-viewer impact <base-dir> <head-dir> [--json] [--open]');
      return 2;
    }
    const baseGraph = buildGraph(path.resolve(baseDir));
    const headGraph = buildGraph(path.resolve(headDir));
    const diff = diffGraphs(baseGraph, headGraph);
    const impact = computeImpact(diff, baseGraph, headGraph);
    if (args.json) {
      console.log(JSON.stringify({ summary: diff.summary, impact }, null, 2));
      return 0;
    }
    const text = formatImpactText(impact);
    if (text) {
      console.log('=== 影响面报告 ===\n');
      console.log(`Base: ${path.basename(path.resolve(baseDir))} (fingerprint: ${baseGraph.fingerprint})`);
      console.log(`Head: ${path.basename(path.resolve(headDir))} (fingerprint: ${headGraph.fingerprint})\n`);
      console.log(text);
    } else {
      console.log('=== 影响面报告 ===');
      console.log('无变更或无下游依赖被波及。');
    }
    return 0;
  }
  if (cmd === 'pr-comment') {
    const baseDir = args._[1];
    const headDir = args._[2];
    if (!baseDir || !headDir) {
      console.error('Usage: arch-viewer pr-comment <base-dir> <head-dir> [--post]');
      return 2;
    }
    const baseGraph = buildGraph(path.resolve(baseDir));
    const headGraph = buildGraph(path.resolve(headDir));
    const diff = diffGraphs(baseGraph, headGraph);
    const impact = computeImpact(diff, baseGraph, headGraph);
    const findings = evaluateRisk(diff, headGraph, baseGraph, impact);
    const riskSummary = summarizeFindings(findings);
    const md = formatPullRequestComment({
      diff, impact, findings, riskSummary,
      baseRef: args.baseRef || process.env.GITHUB_BASE_REF,
      headRef: args.headRef || process.env.GITHUB_HEAD_REF
    });

    if (!args.post) {
      process.stdout.write(md + '\n');
      return 0;
    }
    const result = await postPullRequestComment({ body: md });
    if (result.action === 'skipped') {
      console.error('评论跳过: ' + result.reason);
      console.log('--- Markdown 预览 ---');
      process.stdout.write(md + '\n');
      return 0;
    }
    console.log(`评论已${result.action === 'updated' ? '更新' : '发布'}: ${result.url || ''}`);
    return 0;
  }
  if (cmd === 'session') {
    const subcmd = args._[1];
    const repo = path.resolve(args._[2] || process.cwd());
    const avDir = path.join(repo, '.av');
    const baselinePath = path.join(avDir, 'graph-baseline.json');

    if (subcmd === 'start') {
      fs.mkdirSync(avDir, { recursive: true });
      const graph = buildGraph(repo);
      const snapshot = { ...graph, sessionStartedAt: new Date().toISOString() };
      fs.writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2));
      console.log(`Baseline recorded: ${graph.stats.files} files, ${graph.stats.types} types`);
      console.log(`Fingerprint: ${graph.fingerprint}`);
      console.log(`Saved to: ${baselinePath}`);
      console.log(`\nNow make your AI code changes, then run:`);
      console.log(`  arch-viewer session report`);
      return 0;
    }
    if (subcmd === 'report') {
      if (!fs.existsSync(baselinePath)) {
        console.error('No baseline found. Run `arch-viewer session start` first.');
        return 1;
      }
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      const sessionStart = baseline.sessionStartedAt;
      const current = buildGraph(repo);
      const diff = diffGraphs(baseline, current);
      const impact = computeImpact(diff, baseline, current);
      const findings = evaluateRisk(diff, current, baseline, impact);
      const riskSummary = summarizeFindings(findings);

      // Text output
      console.log(formatDiffText(diff, { all: !!args.all }));
      const findingsText = formatFindingsText(findings);
      if (findingsText) console.log(findingsText + '\n');
      const impactText = formatImpactText(impact);
      if (impactText) console.log(impactText + '\n');

      // Save JSON diff
      const reportJsonPath = path.join(avDir, 'session-report.json');
      fs.writeFileSync(reportJsonPath, JSON.stringify({ diff, findings, riskSummary, impact }, null, 2));

      // Generate HTML report
      const html = generateReport({
        baseGraph: baseline,
        headGraph: current,
        diff,
        findings,
        impact,
        repoName: path.basename(repo),
        sessionStart
      });
      const htmlPath = path.join(avDir, 'session-report.html');
      fs.writeFileSync(htmlPath, html);

      console.log(`Risk level: ${riskSummary.level.toUpperCase()} (${findings.length} findings)`);
      console.log(`JSON report: ${reportJsonPath}`);
      console.log(`HTML report: ${htmlPath}`);
      if (args.open) {
        openInBrowser(htmlPath);
        console.log(`(已在默认浏览器打开 HTML 报告)`);
      }
      console.log(`\nOpen the HTML report in your browser to see the Before/After architecture diagram.`);
      console.log(`变更确认无误后，运行 \`arch-viewer session start\` 刷新基线，开始下一轮验收。`);
      return riskSummary.level === 'high' ? 1 : 0;
    }
    console.error('Usage: arch-viewer session start|report [repo]');
    return 2;
  }
  if (cmd === 'workspace') {
    const subcmd = args._[1];
    const reg = workspace.loadRegistry(args.config);

    if (subcmd === 'add') {
      const repoPath = args._[2];
      if (!repoPath) {
        console.error('Usage: arch-viewer workspace add <repo> [--name id]');
        return 2;
      }
      const res = workspace.addRepo(reg, repoPath, args.name);
      if (!res.added) {
        console.error(res.reason);
        return 1;
      }
      const g = workspace.initBaseline(res.entry.path);
      workspace.saveRegistry(reg);
      console.log(`已注册: ${res.entry.name} → ${res.entry.path}`);
      console.log(`基线已建档: ${g.stats.files} files, ${g.stats.types} types (fingerprint ${g.fingerprint})`);
      console.log(`注册表: ${reg.path}`);
      return 0;
    }
    if (subcmd === 'list') {
      if (reg.repos.length === 0) {
        console.log(`（注册表为空: ${reg.path}）`);
        return 0;
      }
      for (const r of reg.repos) {
        const base = path.join(r.path, '.av', 'graph-baseline.json');
        const status = fs.existsSync(base) ? 'baseline ✔' : '无基线';
        console.log(`  ${r.name.padEnd(20)} ${status.padEnd(12)} ${r.path}`);
      }
      console.log(`\n注册表: ${reg.path}`);
      return 0;
    }
    if (subcmd === 'remove' || subcmd === 'rm') {
      const key = args._[2];
      if (!key || !workspace.removeRepo(reg, key)) {
        console.error(`未找到: ${key || ''}`);
        return 1;
      }
      workspace.saveRegistry(reg);
      console.log(`已移除: ${key}`);
      return 0;
    }
    if (subcmd === 'report') {
      if (reg.repos.length === 0) {
        console.error(`注册表为空: ${reg.path}。先运行 arch-viewer workspace add <repo>`);
        return 2;
      }
      const results = workspace.reportAll(reg);
      if (args.json) {
        console.log(JSON.stringify(results.map((r) => ({
          name: r.name, path: r.path, status: r.status,
          level: r.riskSummary && r.riskSummary.level,
          findings: (r.findings || []).length,
          counts: r.counts,
          impact: r.impact ? {
            changedCount: r.impact.changedCount,
            impactedCount: r.impact.impactedCount,
            itemCount: (r.impact.items || []).length
          } : null,
          error: r.error
        })), null, 2));
        return results.some((r) => r.riskSummary && r.riskSummary.level === 'high') ? 1 : 0;
      }
      console.log(`=== 多仓架构验收（${results.length} 仓） ===`);
      let changed = 0;
      let worst = 'none';
      const order = { none: 0, low: 1, medium: 2, high: 3 };
      for (const r of results) {
        const name = r.name.padEnd(18);
        if (r.status === 'no-baseline') {
          console.log(`  ⚠ ${name} 无基线 — arch-viewer workspace add ${r.path}`);
          continue;
        }
        if (r.status === 'error') {
          console.log(`  ✖ ${name} ERROR: ${r.error}`);
          continue;
        }
        const c = r.counts;
        const level = r.riskSummary.level.toUpperCase();
        if (order[r.riskSummary.level] > order[worst]) worst = r.riskSummary.level;
        if (r.hasChanges) changed += 1;
        const fc = {};
        for (const f of r.findings) fc[f.severity] = (fc[f.severity] || 0) + 1;
        const fText = [
          fc.high ? `🔴×${fc.high}` : '',
          fc.medium ? `🟠×${fc.medium}` : '',
          fc.low ? `🔵×${fc.low}` : ''
        ].filter(Boolean).join(' ');
        const icon = r.riskSummary.level === 'high' ? '✖' : r.hasChanges ? '🔶' : '✔';
        const imp = r.impact;
        const impText = imp && imp.items.length
          ? ` 影响:被改${imp.changedCount} 波及${imp.impactedCount}`
          : '';
        console.log(`  ${icon} ${name} ${level.padEnd(7)} +${c.added} -${c.removed} ~${c.modified}${c.extAdded || c.extRemoved ? ` 外依+${c.extAdded}-${c.extRemoved}` : ''} ${fText}${impText}`);
        if (r.hasChanges) {
          console.log(`      → ${r.htmlPath}`);
          if (args.open) openInBrowser(r.htmlPath);
        }
      }
      const aggImpact = aggregateImpact(results);
      console.log(`\n汇总: ${results.length} 仓，${changed} 仓有变更，最高风险 ${worst.toUpperCase()}` +
        (aggImpact.totalChanged > 0 ? `，影响面: 被改 ${aggImpact.totalChanged} 波及 ${aggImpact.totalImpacted}` : ''));
      if (changed > 0) {
        console.log(`有变更的仓：cd 到对应目录跑 arch-viewer session report 查看明细，确认后 session start 刷新基线。`);
      }
      return worst === 'high' ? 1 : 0;
    }
    console.error('Usage: arch-viewer workspace add|list|remove|report ...');
    return 2;
  }
  console.error('Unknown command: ' + cmd);
  help();
  return 2;
}

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2))).then(
    (code) => process.exit(code || 0),
    (err) => {
      console.error(err.message || err);
      process.exit(1);
    }
  );
}

module.exports = { main, runEval };
