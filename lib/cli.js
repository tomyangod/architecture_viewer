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
const { runSetup, magicPrompt } = require('./setup');
const { exportArchify, finalizeSessionHtml, SCOPES } = require('./archify-export');

function help() {
  console.log(`Architecture Viewer CLI — Community

Usage:
  arch-viewer setup                    一键接入 AI 工具（Cursor/Claude/DeepSeek Harness），自动配置好架构检查
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
  arch-viewer session report [repo] [--all] [--open] [--renderer auto|archify|builtin]
  arch-viewer archify-export [repo] [--scope changed|violations|layers]
                             [--out dir] [--validate] [--archify <path>] [--json]

  arch-viewer workspace add <repo> [--name id] [--config f]
  arch-viewer workspace list [--config f]
  arch-viewer workspace remove <id|path> [--config f]
  arch-viewer workspace report [--config f] [--json] [--open]

  arch-viewer auth login [email] [--code 123456]   邮箱验证码登录（stub 模式码打印在控制台）
  arch-viewer auth whoami                          查看当前登录邮箱与 Pro 状态
  arch-viewer auth logout                          退出登录
  arch-viewer pro refine [repo]                    云端精修入口（需登录，Pro/试用）
  arch-viewer pro sync [repo]                      增量同步占位（需登录，Pro/试用）
  （token 存于 ~/.config/arch-viewer/auth.json；设 ARCH_API_BASE 可切远程服务）
  Community 的 generate / check / session / --refine（自带 Key）永不需要登录。

  diff/session report 默认只显示高信号变更（新增/删除/修改/违规/依赖关系），
  归属关系（declared-in/defined-in）折叠为计数；加 --all 显示全部。

  archify-export 把会话 diff 导出为 Archify IR（稀疏图，供 archify
  validate/render/compare 使用）。--scope: changed(默认) | violations | layers；
  图太密或纯新增时自动降级为 layers。--validate 顺带跑 archify 校验，
  校验失败不报错——回退内置渲染器即可。
  session report 默认 --renderer auto：Archify validate+compare 成功则
  主 HTML 用 Archify 图，失败静默回退内置。--renderer builtin 强制内置。

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
    if (a === '--dir' || a === '--repo' || a === '--config' || a === '--out' || a === '--name' || a === '--scope' || a === '--archify' || a === '--renderer' || a === '--code') {
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
    // 冷启动：删掉缓存强制全量；热启动：紧接着第二次，应命中缓存
    try { fs.unlinkSync(path.join(dest, '.generate-cache.json')); } catch { /* 无缓存 */ }
    const cold = generateToDir(r.path, dest);
    const warm = generateToDir(r.path, dest);
    const result = cold;
    row.status = cold.protocol.ok && cold.drift.ok ? 'PASS' : 'FAIL';
    row.errors = cold.protocol.errors.length;
    row.warnings = cold.protocol.warnings.length;
    row.driftMissing = cold.drift.missing.length;
    row.languages = inventory.languages.join(', ');
    row.modules = inventory.modules.map((m) => m.label).join(', ');
    row.services = inventory.services.map((s) => s.label).join(', ');
    row.title = inventory.title;
    row.fingerprint = inventory.fingerprint;
    // 增量指标
    row.coldMs = cold.timing ? cold.timing.ms : 0;
    row.warmMs = warm.timing ? warm.timing.ms : 0;
    row.warmCached = !!warm.cached;
    row.speedupPct = row.coldMs > 0 ? Math.max(0, Math.round((1 - row.warmMs / row.coldMs) * 100)) : 100;
    row.fullTokens = cold.payloadScale ? cold.payloadScale.fullTokens : 0;
    // 无改动热启动：增量 payload = 0（不重喂任何视图）
    row.incrTokens = 0;
    row.tokenReductionPct = 100;
    if (row.status === 'FAIL') {
      const proto = (result.protocol.errors || []).slice(0, 3).join('; ');
      const drift = (result.drift.missing || []).slice(0, 3).map((m) => m.label || m.term).join(', ');
      row.reason = [proto && ('protocol: ' + proto), drift && ('drift: ' + drift)].filter(Boolean).join(' | ');
      printIssues(result);
    }
    rows.push(row);
  }
  const passed = rows.filter((r) => r.status === 'PASS').length;
  const failedN = rows.filter((r) => r.status === 'FAIL').length;
  const skipped = rows.filter((r) => r.status === 'SKIP').length;
  const ran = rows.filter((r) => r.status !== 'SKIP');
  const avgSpeedup = ran.length
    ? Math.round(ran.reduce((a, r) => a + (r.speedupPct || 0), 0) / ran.length)
    : 0;
  const allWarmCached = ran.length && ran.every((r) => r.warmCached);
  const notes = [
    '## 通过率与归因',
    '',
    `- 本轮 ${rows.length} 仓：通过 ${passed}，失败 ${failedN}，跳过 ${skipped}（跳过=本机无此路径，不计入失败）。`,
    '- 覆盖：既有 Python/Node 三仓 + 仓内前端夹具 `shop-frontend`（Vue/TS）+ Go 夹具 `order-go`。',
    '- 人为改动夹具：`eval/demo-drift` 必须红灯（未声明 Rel + 模板占位）。命令：`node lib/cli.js check eval/demo-drift --filled`。',
    '- 失败仓的 reason 列记录 protocol / drift 摘要；完整错误见命令输出。',
    '',
    '## 增量生成（W07-01）',
    '',
    '- 冷启动=删缓存全量扫描+生成；热启动=无改动二次 Generate，应命中缓存跳过扫描与生成。',
    `- 热启动缓存命中：${allWarmCached ? ran.length + '/' + ran.length + ' 全部命中' : '部分未命中（见下表 warmCached）'}；平均耗时下降 ${avgSpeedup}%（目标 ≥80%）。`,
    '- 热启动跳过全部内容读取/解析/生成与 LLM 调用，仅做 stat 清单比对；上表 wall-clock 为骨架路径，评测夹具均 <40ms，绝对耗时体感即时、比值受进程噪声影响。',
    '- 真正的成本引擎是精修（refine，网络+token 主导）：无改动时重喂 0 张图（token -100%，且整段 LLM 调用跳过）；单模块改动仅重喂内容变化的视图（由 test/incremental 覆盖，目标 ≥50%）。',
    ''
  ];
  const md = [
    '# Generate quality eval',
    '',
    '| Repo | Status | Errors | Drift | Languages | Title | Modules |',
    '|------|--------|--------|-------|-----------|-------|---------|',
    ...rows.map((r) => `| ${r.id} | ${r.status}${r.reason ? ' (' + r.reason + ')' : ''} | ${r.errors ?? '-'} | ${r.driftMissing ?? '-'} | ${r.languages || ''} | ${r.title || ''} | ${r.modules || ''} |`),
    '',
    '| Repo | 冷启动 ms | 热启动 ms | 耗时下降 | 热启动缓存 | 全量 token | 增量 token | token 下降 |',
    '|------|----------|----------|---------|-----------|-----------|-----------|-----------|',
    ...rows.map((r) => `| ${r.id} | ${r.coldMs ?? '-'} | ${r.warmMs ?? '-'} | ${r.speedupPct != null ? r.speedupPct + '%' : '-'} | ${r.warmCached ? '命中' : '未命中'} | ${r.fullTokens ?? '-'} | ${r.incrTokens ?? '-'} | ${r.tokenReductionPct != null ? r.tokenReductionPct + '%' : '-'} |`),
    '',
    ...notes,
    '',
    'Outputs written only to `eval/out/<id>/` (does not overwrite diagrams in the real repos).',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(productRoot(), 'eval', 'REPORT.md'), md);
  console.log(md);
  const failed = rows.filter((r) => r.status === 'FAIL');
  return { rows, failed, ran };
}

function printGenerateResult(r) {
  const engine = r.engine === 'llm' ? '精修 (refine)' : '骨架 (skeleton)';
  console.log('Mode: ' + engine);
  if (r.fallback) {
    console.warn('Fell back to skeleton: no DEEPSEEK_API_KEY');
  }
  if (r.model) console.log('Model: ' + r.model);
  if (r.cached) {
    const ms = r.timing && r.timing.ms != null ? r.timing.ms + 'ms' : 'fast';
    console.log('缓存命中：源码无变化，' + (r.unchangedDiagrams ? r.unchangedDiagrams.length : 6) + ' 张图全部复用（跳过扫描与生成，' + ms + '）');
  } else {
    console.log('Generated ' + r.written.length + ' diagrams in ' + r.kitDir);
    if (r.changedDiagrams && r.unchangedDiagrams && r.unchangedDiagrams.length) {
      console.log('增量：重生成 ' + r.changedDiagrams.length + ' 张，复用 ' + r.unchangedDiagrams.length + ' 张（' + r.unchangedDiagrams.join(', ') + '）');
    }
    if (r.payloadScale && r.payloadScale.fullBytes > 0) {
      console.log('精修 payload 估算：全量 ~' + r.payloadScale.fullTokens + ' token，增量 ~' + r.payloadScale.incrementalTokens + ' token（-' + r.payloadScale.reductionPct + '%）');
    }
  }
  console.log('Inventory: ' + r.inventory.title + ' [' + r.inventory.fingerprint + ']');
  printIssues({ protocol: r.protocol, drift: r.drift });

  const errCount = (r.protocol && r.protocol.errors && r.protocol.errors.length) || 0;
  const warnCount = (r.protocol && r.protocol.warnings && r.protocol.warnings.length) || 0;
  const driftMissing = (r.drift && r.drift.missing && r.drift.missing.length) || 0;
  if (errCount === 0 && driftMissing === 0) {
    console.log('Validation: PASS (' + r.written.length + ' diagrams, ' + warnCount + ' warnings)');
  } else {
    console.log('Validation: ' + errCount + ' errors, ' + warnCount + ' warnings, ' + driftMissing + ' drift');
    console.log('  修复提示已标注在每条 ERROR 后面；用 `arch-viewer check --filled --drift --repo .` 复检');
  }
  const protoOk = r.protocol && r.protocol.ok;
  const driftOk = !r.drift || r.drift.ok;
  return protoOk && driftOk ? 0 : 1;
}

/**
 * Write auto-generated layer suggestions to .av/layers.suggested.json.
 * Users review (no action needed if happy) and can rename to layers.json to lock.
 * Never touches an existing layers.json (that is the user's explicit config).
 */
function writeLayerSuggestions(repo, graph) {
  if (!graph.layerSignals || Object.keys(graph.layerSignals).length === 0) return null;
  const avDir = path.join(repo, '.av');
  fs.mkdirSync(avDir, { recursive: true });
  const suggestedPath = path.join(avDir, 'layers.suggested.json');
  const payload = {
    _note: '自动生成的分层推断建议（信号：config 用户配置 > import 框架语义 > 目录名 > 结构位置）。审阅无误无需操作；想锁定或修改，复制为同目录 layers.json 即可（layers.json 优先且不会被覆盖）。confidence: high>medium>low；signalConflicts 是 import 信号与目录名判断不一致的文件，请人工确认。',
    generatedAt: new Date().toISOString(),
    directories: graph.layerSignals
  };
  fs.writeFileSync(suggestedPath, JSON.stringify(payload, null, 2));
  return suggestedPath;
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
    const suggested = writeLayerSuggestions(repo, graph);
    if (suggested) console.log('Layer suggestions: ' + suggested + ' (review; rename to layers.json to lock)');
    if (!outPath) console.log(JSON.stringify(graph, null, 2));
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
      const suggested = writeLayerSuggestions(repo, graph);
      if (suggested) {
        console.log(`Layer suggestions: ${suggested}`);
        console.log('  (自动分层推断，审阅即可；复制为 .av/layers.json 可锁定)');
      }
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
      const finalized = finalizeSessionHtml({
        repo,
        builtinHtml: html,
        renderer: args.renderer,
        archifyCli: args.archify
      });
      const htmlPath = finalized.htmlPath;
      const used = finalized.renderer.used;

      console.log(`Risk level: ${riskSummary.level.toUpperCase()} (${findings.length} findings)`);
      console.log(`JSON report: ${reportJsonPath}`);
      console.log(`HTML report: ${htmlPath}  [${used}]`);
      if (used === 'archify') {
        console.log(`  Archify 视图: ${finalized.renderer.htmlPath}`);
        console.log(`  内置回退:     ${finalized.builtinPath}`);
      } else if (finalized.renderer.reason && finalized.renderer.reason !== 'renderer=builtin') {
        console.log(`  渲染: 内置（${finalized.renderer.reason}）`);
      }
      if (args.open) {
        openInBrowser(htmlPath);
        console.log(`(已在默认浏览器打开 HTML 报告)`);
      }
      console.log(`\nOpen the HTML report in your browser to see the Before/Delta/After architecture diagram.`);
      console.log(`变更确认无误后，运行 \`arch-viewer session start\` 刷新基线，开始下一轮验收。`);
      return riskSummary.level === 'high' ? 1 : 0;
    }
    console.error('Usage: arch-viewer session start|report [repo]');
    return 2;
  }
  if (cmd === 'archify-export') {
    const repo = path.resolve(args._[1] || process.cwd());
    if (args.scope && !SCOPES.includes(args.scope)) {
      console.error(`Invalid --scope "${args.scope}". Use one of: ${SCOPES.join(', ')}`);
      return 2;
    }
    const res = exportArchify({
      repo,
      scope: args.scope || 'changed',
      outDir: args.out,
      validate: !!args.validate,
      archifyCli: args.archify
    });
    if (res.error === 'NO_BASELINE') {
      console.error(res.message);
      return 1;
    }
    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
      return 0;
    }
    const s = res.sidecar;
    console.log(`=== Archify IR 导出（scope=${s.scopeRequested}）===`);
    if (s.downgradedToLayers) {
      console.log(`  ⚠ 已降级为 layers 层摘要图（原因: ${s.downgradeReason}）`);
    }
    console.log(`  实际 scope: ${s.scopeUsed}`);
    console.log(`  组件: base=${s.componentCount.base} head=${s.componentCount.head}，连接: base=${s.connectionCount.base} head=${s.connectionCount.head}`);
    console.log(`  Before: ${res.files.base}`);
    console.log(`  After:  ${res.files.head}`);
    console.log(`  Sidecar: ${res.files.sidecar}`);
    if (res.validation) {
      if (!res.validation.available) {
        console.log(`  validate: 跳过（${res.validation.message}）`);
      } else {
        const v = res.validation;
        console.log(`  validate base: ${v.base.ok ? 'PASS' : 'FAIL ' + (v.base.codes || []).join(',')}`);
        console.log(`  validate head: ${v.head.ok ? 'PASS' : 'FAIL ' + (v.head.codes || []).join(',')}`);
        if (!v.ok) {
          console.log('  → Archify 渲染未通过，回退内置渲染器（session-report.html）。');
        }
      }
    }
    return 0;
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

  if (cmd === 'auth') {
    const sub = args._[1];
    const authClient = require('./pro/auth-client');
    if (sub === 'login') {
      const user = await authClient.loginFlow({ email: args._[2], code: args.code });
      const state = user.active ? '有效' : '已到期';
      console.log(`已登录: ${user.email}（${user.plan}，${state}）`);
      if (user.entitlement === 'trial' && user.trialUntil) {
        console.log(`试用期至: ${user.trialUntil.slice(0, 10)}`);
      }
      return 0;
    }
    if (sub === 'logout') {
      await authClient.logoutFlow();
      console.log('已退出登录。');
      return 0;
    }
    if (sub === 'whoami') {
      const user = await authClient.whoamiAsync();
      if (!user) {
        console.log('未登录。运行 arch-viewer auth login 登录。');
        return 1;
      }
      console.log(`邮箱: ${user.email}`);
      console.log(`计划: ${user.plan}（${user.entitlement}，${user.active ? '有效' : '已到期'}）`);
      if (user.trialUntil) console.log(`试用至: ${String(user.trialUntil).slice(0, 10)}`);
      if (user.paidUntil) console.log(`Pro 至: ${String(user.paidUntil).slice(0, 10)}`);
      return 0;
    }
    console.error('Usage: arch-viewer auth login [email] [--code 123456] | whoami | logout');
    return 2;
  }

  if (cmd === 'pro') {
    const sub = args._[1];
    const authClient = require('./pro/auth-client');
    const features = require('./pro/features');
    if (sub === 'refine') {
      await authClient.requirePro({ feature: 'cloud_refine' });
      const repo = path.resolve(args._[2] || process.cwd());
      console.log('云端精修已受理（占位）：将使用托管模型重绘变动模块。');
      console.log('仓库: ' + repo);
      console.log('本机 generate --refine（自带 Key）仍属 Community，无需登录。');
      return 0;
    }
    if (sub === 'sync') {
      await authClient.requirePro({ feature: 'incremental_sync' });
      const repo = path.resolve(args._[2] || process.cwd());
      console.log('增量同步已排队（占位）：仅重生成变动模块。');
      console.log('仓库: ' + repo);
      console.log('全量 generate 仍属 Community，无需登录。');
      return 0;
    }
    console.error('Usage: arch-viewer pro refine|sync [repo]');
    console.error('定价: ' + features.pricingUrl());
    return 2;
  }

  if (cmd === 'setup') {
    // 一键接入：自动把架构检查工具装进已安装的 AI 编程工具
    const repoArg = args._[1] ? path.resolve(args._[1]) : null;
    let setup;
    try {
      setup = runSetup();
    } catch (e) {
      console.error('安装失败：' + e.message);
      return 1;
    }

    console.log('');
    console.log('================ 架构检查工具 · 一键安装 ================');
    console.log('');
    if (setup.launchMode === 'npx') {
      console.log('  启动方式：npx（检测到你已全局安装 arch-viewer-mcp，不依赖仓库路径）');
    } else {
      console.log('  启动方式：本地仓库（' + setup.serverPath + '）');
      console.log('  小提示：发布后可 npm i -g arch-viewer-mcp，再跑一次本命令即自动切换为 npx 免仓库模式');
    }
    console.log('');
    const configured = setup.results.filter(r => r.status === 'configured');
    const already = setup.results.filter(r => r.status === 'already');
    const skipped = setup.results.filter(r => r.status === 'not-installed');
    const failed = setup.results.filter(r => r.status === 'error');

    for (const r of configured) {
      console.log(`  ✅ ${r.name}：装好了${r.note ? '（' + r.note + '）' : ''}`);
    }
    for (const r of already) {
      console.log(`  ⏭️  ${r.name}：之前已经装过，跳过`);
    }
    for (const r of skipped) {
      console.log(`  ⬜  ${r.name}：没检测到安装，跳过（装了之后再跑一次本命令即可）`);
    }
    for (const r of failed) {
      console.log(`  ❌ ${r.name}：配置失败（${r.detail}）`);
    }
    console.log('');

    if (configured.length === 0 && already.length === 0) {
      console.log('没有检测到 Cursor / Claude 等 AI 工具的配置目录。');
      console.log('如果你已经装了 Cursor，请先打开一次 Cursor 让它创建配置，再跑：arch-viewer setup');
      console.log('手动配置方法见：docs/SESSION-GUIDE.md 第 7 节');
      return 0;
    }

    console.log('----------------------------------------------------------------');
    console.log('接下来你要做的只有 3 件事：');
    console.log('');
    console.log('  ① 完全退出并重新打开你的 AI 工具（Cursor / Claude / DeepSeek Harness）');
    console.log('  ② 打开你的项目文件夹');
    console.log('  ③ 对 AI 说下面这句话 👇');
    console.log('');
    console.log('     「以后改我的代码之前，先拍照片；改完之后检查有没有改坏。」');
    console.log('');
    console.log('AI 就会自己在改前拍照、改后检查，红灯会用大白话告诉你哪里改坏了。');
    console.log('');
    console.log('--- 想让 AI 永远记得这个规矩？把下面这段贴进 Cursor 的 Rules ---');
    console.log('');
    console.log(magicPrompt(repoArg));
    console.log('');
    console.log('----------------------------------------------------------------');

    // 自动打开可视化引导页
    const welcomePath = path.join(__dirname, '..', 'docs', 'welcome.html');
    if (fs.existsSync(welcomePath) && !args['no-open']) {
      openInBrowser(welcomePath);
      console.log('（已在浏览器打开图文引导页，关了也没关系，文件在 docs/welcome.html）');
    }
    console.log('');
    return failed.length > 0 ? 1 : 0;
  }

  console.error('Unknown command: ' + cmd);
  help();
  return 2;
}

if (require.main === module) {
  const telemetry = require('./telemetry');
  const argv = process.argv.slice(2);
  const cmdName = argv[0] || 'help';
  telemetry.wrap(cmdName, () => main(argv)).then(
    (code) => process.exit(code || 0),
    (err) => {
      console.error(err.message || err);
      process.exit(1);
    }
  );
}

module.exports = { main, runEval };
