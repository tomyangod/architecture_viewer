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

const { buildGraph, extractGraphTo, loadGraphInput } = require('./extract-graph');
const { diffGraphs, formatDiffText } = require('./diff-graph');
const { evaluateRisk, summarizeFindings, loadSessionRules } = require('./risk-rules');
const { assessAnalysisCompleteness, applyCompletenessToRisk } = require('./analysis-completeness');
const { generateReport, appendSessionHistory, readSessionHistory, formatHistoryTable, clearStaleSessionReports, buildSessionReportJson } = require('./session-report');
const PKG_VERSION = require('../package.json').version;
const { computeImpact, formatImpactText, aggregateImpact } = require('./impact');
const { formatPullRequestComment, postPullRequestComment, baselineFileChanged } = require('./pr-comment');
const workspace = require('./workspace');
const { runSetup, magicPrompt } = require('./setup');
const { runUninstall } = require('./uninstall');
const { exportArchify, finalizeSessionHtml, SCOPES } = require('./archify-export');
const { EXIT, shouldGate, normalizeFailOn, exitCodeForCheck, exitCodeFromError, exitCodeForAnalysis } = require('./exit-codes');
const { detectPathMismatch, isGitWorktree, samePath } = require('./session-paths');
const { resolveSessionBaseline } = require('./session-baseline');
const { writeSessionIntent } = require('./session-intent');

function help() {
  console.log(`Architecture Viewer CLI — Community v${PKG_VERSION}

Usage:
  arch-viewer --version                打印本包版本（与 MCP initialize.serverInfo.version 同源）
  arch-viewer setup                    一键接入 AI 工具（Cursor/Claude/DeepSeek Harness），自动配置好架构检查
  arch-viewer init [repo] [--dir architecture_viewer] [--compat-six-views]
  arch-viewer generate [repo] [--dir architecture_viewer] [--refine | --skeleton]
             [--views block,class,...] [--focus path] [--confirm-context] [--compat-six-views]
  arch-viewer check [kit-or-repo] [--drift] [--filled] [--repo <root>] [--rules <file>]
  arch-viewer prompt [repo]
  arch-viewer eval [--config eval/repos.json]

  arch-viewer extract [repo] [--out graph.json]
  arch-viewer diff <base-dir|graph.json> <head-dir|graph.json> [--json] [--all]
                              [--fail-on high|medium|low|none]
  arch-viewer impact <base-dir> <head-dir> [--json] [--open]
  arch-viewer pr-comment <base-dir> <head-dir> [--post]
  arch-viewer session start [repo] [--intent "只修分层，不改 /todos"]
  arch-viewer session report [repo] [--all] [--open] [--renderer auto|archify|builtin] [--rules <file>]
                              [--fail-on high|medium|low|none]
  arch-viewer session guard [repo] [--adapter cursor|claude|generic]   # hooks / CI 通用结构门
  arch-viewer session history [repo] [--lines N]   查看本地技术债趋势（.av/session-history.jsonl）
  arch-viewer setup [repo] [--project] [--no-open]  一键接入 MCP；--project 写入本仓 hooks/规则
  arch-viewer uninstall [repo] [--npm] [--purge]    对称卸载：用户级 MCP；给 repo 则卸本仓 hooks
  arch-viewer archify-export [repo] --confirm [--scope changed|violations|layers]
                             [--out dir] [--validate] [--archify <path>] [--json]

  arch-viewer workspace add <repo> [--name id] [--config f]
  arch-viewer workspace list [--config f]
  arch-viewer workspace remove <id|path> [--config f]
  arch-viewer workspace report [--config f] [--json] [--open]

  arch-viewer auth login [email] [--code 123456]   邮箱验证码登录（stub 模式码打印在控制台）
  arch-viewer auth trial [email] [--code 123456]   开启 7 天 Pro 试用（首次登录即 trial）
  arch-viewer auth whoami                          查看当前登录邮箱与 Pro 状态
  arch-viewer auth logout                          退出登录
  arch-viewer pro refine [repo]                    云端精修入口（需登录，Pro/试用）
  arch-viewer pro sync [repo]                      增量同步占位（需登录，Pro/试用）
  （token 存于 ~/.config/arch-viewer/auth.json；设 ARCH_API_BASE 可切远程服务）
  Community 的 generate / check / session / --refine（自带 Key）永不需要登录。

  diff/session report 默认只显示高信号变更（新增/删除/修改/违规/依赖关系），
  归属关系（declared-in/defined-in）折叠为计数；加 --all 显示全部。

  默认产品交付：本轮结构变更报告 + Block 静态结构总览。
  类图按需局部生成；C4 Context 需 --confirm-context；C4 Container/Component
  与无启动证据的 Deployment 不进入默认交付。六视图仅 --compat-six-views。
  --refine 精修所选视图，不在首发质量承诺内，不能用协议通过替代事实审查。

  archify-export 需 --confirm（人工核对证据后）。IR 供 archify 讲解已确认模型。
  --scope: changed(默认) | violations | layers；过密或纯新增时降级为 layers。
  session report 默认 --renderer builtin（内置 Before/Delta/After）。
  --renderer archify|auto 为显式选用 Archify 成片，失败仍回退内置。

Generate:
  (default)   只写默认视图（Block；有编排证据才加 Deploy；有 --focus/git 改动才加局部类图）
  --views     按需：block,class,c4-context,c4-container,c4-component,deployment
  --compat-six-views  兼容路径，一次写齐六张（停止扩张，不作为卖点）
  --refine    精修所选视图（需 DEEPSEEK_API_KEY；不在首发质量承诺内）
  --skeleton  强制骨架（即使已配置 Key）

Exit codes (CI / pre-commit 可直接用退出码判断，不用解析输出):
  session report / check / diff 共用同一张表：
  0  成功，架构门通过（无风险或低于 --fail-on 阈值；check 则套件/漂移/规则通过）
  1  成功，但架构门未通过（HIGH 或 --fail-on 阈值；check 则协议/漂移/规则违规。报告已写出，不是崩溃）
  2  参数或配置错误（缺参数、未知命令、--fail-on 非法、--rules 缺失或无法解析）
  3  扫描或解析失败（构图/写报告抛错；路径存在但不是可扫描目录）
  4  基线不存在或失效（无 git HEAD 且无/坏 graph-baseline.json；check 无套件图或 --repo 不存在；diff 路径不存在或图 JSON 损坏）

  session report / workspace report / diff 支持 --fail-on:
    high（默认）  仅 HIGH 风险阻断（退出码 1）
    medium        MEDIUM 及以上阻断
    low           任何 finding 都阻断
    none          只报告不阻断（CI 里不要用）
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-V' || a === '--version') {
      out.version = true;
    } else if (a === '--dir' || a === '--repo' || a === '--config' || a === '--out' || a === '--name' || a === '--scope' || a === '--archify' || a === '--renderer' || a === '--code' || a === '--rules' || a === '--lines' || a === '--fail-on' || a === '--intent' || a === '--adapter' || a === '--views' || a === '--focus') {
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

// Walk up from `dir` to find the nearest .git (directory or file, the latter
// for worktrees/submodules). Returns the repo root absolute path or null.
// Zero-dependency: avoids spawning git so it stays offline and fast.
function findGitRoot(dir) {
  let cur = path.resolve(dir);
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

function formatFindingsText(findings) {
  if (!findings || findings.length === 0) return '';
  const lines = ['--- 风险发现 ---'];
  for (const f of findings) {
    const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : f.severity === 'low' ? '🔵' : '⚪';
    lines.push(`  ${icon} [${f.severity.toUpperCase()}] ${f.title}: ${f.message}`);
    if (f.detail) lines.push(`     ${f.detail}`);
    if (f.sourceAnalyzer) {
      lines.push(`     Analyzer: ${f.sourceAnalyzer}${f.secondarySource ? ` + ${f.secondarySource}` : ''} (${f.confidence})`);
    }
  }
  return lines.join('\n');
}

function printIssues(result) {
  if (result.configError) {
    console.error(`Rules config error (exit 2): ${result.configError}`);
  }
  if (result.scanError) {
    console.error(`Scan failed (exit 3): ${result.scanError}`);
  }
  if (result.missingRepo) {
    console.error('Repo path does not exist (exit 4). Check --repo.');
  }
  if (result.missingKit) {
    console.error('No architecture kit found (exit 4). Run `arch-viewer init` then `generate`, or pass the kit directory.');
  }
  if (!result.protocol) return;
  if (result.missingKit) return;
  for (const e of result.protocol.errors) console.error('ERROR  ' + e);
  for (const w of result.protocol.warnings) console.warn('WARN   ' + w);
  if (result.drift && result.drift.missing && result.drift.missing.length) {
    for (const m of result.drift.missing) {
      console.error(`DRIFT  ${m.kind} "${m.label}" (${m.term}) not found in diagrams`);
    }
  }
  if (result.rules && result.rules.violations && result.rules.violations.length) {
    console.error('--- rules ---');
    for (const v of result.rules.violations) {
      const detail = v.detail ? ' — ' + v.detail : '';
      console.error(`RULE   [${v.rule}] ${v.file || ''}: ${v.message}${detail}`);
    }
  } else if (result.rules && result.rules.error) {
    console.error('--- rules ---');
    console.error('RULE   [rules-file] ' + result.rules.error);
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
    row.driftChecked = cold.drift.checked || 0;
    // 误报率：对每条 drift missing，用 CamelCase/部分匹配启发式判定是否为 FP
    if (cold.drift.missing.length > 0) {
      const hay = cold.drift.missing.map((m) => m.label || m.term);
      row.driftItems = hay;
      let fp = 0;
      const kitText = DIAGRAM_FILES.map((f) => {
        try { return fs.readFileSync(path.join(dest, f), 'utf8'); } catch { return ''; }
      }).join('\n');
      for (const m of cold.drift.missing) {
        const term = m.term || '';
        const label = m.label || '';
        // 如果 diagram 里有 CamelCase 形式但 snake_case 没匹配上 → 可能是 FP
        const camel = term.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/^./, c => c.toUpperCase());
        if (camel.length >= 3 && kitText.includes(camel)) fp++;
      }
      row.fpCount = fp;
      row.fpRate = cold.drift.missing.length > 0 ? Math.round(fp / cold.drift.missing.length * 100) : 0;
    } else {
      row.driftItems = [];
      row.fpCount = 0;
      row.fpRate = 0;
    }
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
    '- 覆盖：Python/Node 三仓 + 前端夹具 `shop-frontend`（Vue/TS）+ Go 夹具 `order-go`+ Java 夹具 `java-order`（Spring/Maven）。',
    '- 人为改动夹具：`eval/demo-drift` 必须红灯（未声明 Rel + 模板占位）。命令：`node lib/cli.js check eval/demo-drift --filled`。',
    '- 失败仓的 reason 列记录 protocol / drift 摘要；完整错误见命令输出。',
    '',
    '## 增量生成（W07-01）',
    '',
    '- 冷启动=删缓存全量扫描+生成；热启动=无改动二次 Generate，应命中缓存跳过扫描与生成。',
    `- 热启动缓存命中：${allWarmCached ? ran.length + '/' + ran.length + ' 全部命中' : '部分未命中（见下表 warmCached）'}；平均耗时下降 ${avgSpeedup}%（目标 ≥80%）。`,
    '- 热启动跳过全部内容读取/解析/生成与 LLM 调用，仅做 stat 清单比对；上表 wall-clock 为骨架路径，评测夹具均 <40ms，绝对耗时体感即时、比值受进程噪声影响。',
    '- 真正的成本引擎是精修（refine，网络+token 主导）：无改动时重喂 0 张图（token -100%，且整段 LLM 调用跳过）；单模块改动仅重喂内容变化的视图（由 test/incremental 覆盖，目标 ≥50%）。',
    '',
    '## 漂移检测精度（W10-01）',
    '',
    '- 误报率 = 启发式 FP / drift missing 总数；FP 判定：drift 报缺失但 diagram 里有 CamelCase 形式（snake→CamelCase 反查命中）。',
    `- 本轮 drift missing 为 0 的仓：${ran.filter((r) => r.driftMissing === 0).length}/${ran.length}（FP 率 0%）。`,
    `- 目标：误报率 <20%（零漂移仓自动达标）。`,
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
    '| Repo | Drift 检查项 | Missing | 误报 FP | 误报率 |',
    '|------|-----------|---------|---------|--------|',
    ...rows.map((r) => `| ${r.id} | ${r.driftChecked ?? '-'} | ${r.driftMissing ?? 0} | ${r.fpCount ?? 0} | ${r.fpRate ?? 0}% |`),
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
  if (r.viewPolicy) {
    console.log('View policy: ' + r.viewPolicy + (r.viewPolicy === 'default' ? '（默认不是六张图）' : ''));
  }
  if (r.receipt && Array.isArray(r.receipt.selected)) {
    console.log('本轮选定: ' + (r.receipt.selected.map((f) => f.replace(/\.md$/, '')).join(', ') || '(无)'));
  }
  if (r.skippedViews && r.skippedViews.length) {
    console.log('未选入默认交付: ' + r.skippedViews.map((s) => s.file.replace(/\.md$/, '')).join(', '));
  }
  if (r.retainedNotUpdated && r.retainedNotUpdated.length) {
    console.log('磁盘保留未更新（勿当成本轮新图）: ' + r.retainedNotUpdated.map((f) => f.replace(/\.md$/, '')).join(', '));
  }
  if (r.removedTemplates && r.removedTemplates.length) {
    console.log('已清理未选中的模板占位稿: ' + r.removedTemplates.map((f) => f.replace(/\.md$/, '')).join(', '));
  }
  if (r.cached) {
    const ms = r.timing && r.timing.ms != null ? r.timing.ms + 'ms' : 'fast';
    const n = r.unchangedDiagrams ? r.unchangedDiagrams.length : 0;
    console.log('缓存命中：源码、配置、引擎与产物内容一致，' + n + ' 张图全部复用（跳过扫描与生成，' + ms + '）');
  } else {
    console.log('Generated ' + r.written.length + ' diagrams in ' + r.kitDir);
    if (r.changedDiagrams && r.unchangedDiagrams && r.unchangedDiagrams.length) {
      console.log('增量：重生成 ' + r.changedDiagrams.length + ' 张，复用 ' + r.unchangedDiagrams.length + ' 张（' + r.unchangedDiagrams.join(', ') + '）');
    }
    if (r.payloadScale && r.payloadScale.fullBytes > 0) {
      console.log('骨架文本估算：全量 ~' + r.payloadScale.fullTokens + ' token，变动 ~' + r.payloadScale.incrementalTokens + ' token（不是精修 API 用量）');
    }
  }
  console.log('Inventory: ' + r.inventory.title + ' [' + r.inventory.fingerprint + ']');
  printIssues({ protocol: r.protocol, drift: r.drift });
  console.log('校验范围：图协议与库存覆盖；不验证运行时语义，需人工核实节点和边。');

  const errCount = (r.protocol && r.protocol.errors && r.protocol.errors.length) || 0;
  const warnCount = (r.protocol && r.protocol.warnings && r.protocol.warnings.length) || 0;
  const driftMissing = (r.drift && r.drift.missing && r.drift.missing.length) || 0;
  if (errCount === 0 && driftMissing === 0) {
    console.log('Validation: PASS (' + r.written.length + ' diagrams, ' + warnCount + ' warnings)');
  } else {
    console.log('Validation: ' + errCount + ' errors, ' + warnCount + ' warnings, ' + driftMissing + ' drift');
    console.log('  修复提示已标注在每条 ERROR 后面；用 `arch-viewer check --filled --drift --repo .` 复检');
    try {
      require('./pro/funnel').maybePaywallAfterValueMoment({
        driftMissing,
        findingsCount: errCount,
        reason: 'drift'
      });
    } catch { /* ignore */ }
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

function generateViewOptions(args) {
  return {
    views: args.views,
    compatSix: !!(args['compat-six-views'] || args['six-views']),
    confirmContext: !!args['confirm-context'],
    focus: args.focus
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.version || args._[0] === 'version') {
    console.log(PKG_VERSION);
    return 0;
  }
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) {
    help();
    return 0;
  }
  if (cmd === 'init') {
    const repo = args._[1] || process.cwd();
    const r = initKit(repo, args.dir, { compatSix: !!(args['compat-six-views'] || args['six-views']) });
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
    const viewOpts = generateViewOptions(args);
    try {
      if (wantsRefine(args)) {
        const r = await generateForRepoAsync(repo, args.dir, Object.assign({ mode: 'llm', strict: true }, viewOpts));
        return printGenerateResult(r);
      }
      const r = generateForRepo(repo, args.dir, viewOpts);
      r.engine = 'skeleton';
      r.fallback = false;
      return printGenerateResult(r);
    } catch (e) {
      if (e && e.code === 'UNKNOWN_VIEW') {
        console.error('Argument error (exit 2): ' + e.message);
        return 2;
      }
      throw e;
    }
  }
  if (cmd === 'check') {
    const target = path.resolve(args._[1] || process.cwd());
    const kitDir = fs.existsSync(path.join(target, 'architecture_visualized.html'))
      ? target
      : (findKitDir(target) || target);
    const result = checkKit(kitDir, {
      requireFilled: !!args.filled,
      drift: !!args.drift,
      repo: args.repo || undefined,
      rules: args.rules || undefined
    });
    printIssues(result);
    if (result.ok) console.log('OK  ' + kitDir);
    return exitCodeForCheck(result);
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
      console.error('Usage: arch-viewer diff <base-dir|graph.json> <head-dir|graph.json>');
      return EXIT.USAGE_ERROR;
    }
    let failOn;
    try {
      failOn = normalizeFailOn(args.failOn || args['fail-on']);
    } catch (e) {
      console.error(`Argument error (exit 2): ${e.message}`);
      return EXIT.USAGE_ERROR;
    }
    let baseGraph;
    let headGraph;
    try {
      baseGraph = loadGraphInput(path.resolve(baseDir));
      headGraph = loadGraphInput(path.resolve(headDir));
    } catch (e) {
      console.error(e.message);
      return exitCodeFromError(e);
    }
    const diff = diffGraphs(baseGraph, headGraph);
    const impact = computeImpact(diff, baseGraph, headGraph);
    const diffFindings = evaluateRisk(diff, headGraph, baseGraph, impact);
    const riskSummary = summarizeFindings(diffFindings);
    if (args.json) {
      console.log(JSON.stringify({ ...diff, findings: diffFindings, risk: riskSummary }, null, 2));
    } else {
      console.log(formatDiffText(diff, { all: !!args.all }));
      const diffFindingsText = formatFindingsText(diffFindings);
      if (diffFindingsText) console.log('\n' + diffFindingsText);
      const impactText = formatImpactText(impact);
      if (impactText) console.log('\n' + impactText);
    }
    const gated = shouldGate(riskSummary.gateLevel || riskSummary.level, failOn);
    if (gated) {
      console.log(`\n⛔ 架构验收门未通过：${riskSummary.level.toUpperCase()} 风险达到 --fail-on=${failOn} 阈值，退出码 = 1。`);
    }
    return gated ? EXIT.GATE_FAILED : EXIT.OK;
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
    const baseAbs = path.resolve(baseDir);
    const headAbs = path.resolve(headDir);
    const baselineChanged = baselineFileChanged(baseAbs, headAbs);
    const md = formatPullRequestComment({
      diff, impact, findings, riskSummary,
      baseRef: args.baseRef || process.env.GITHUB_BASE_REF,
      headRef: args.headRef || process.env.GITHUB_HEAD_REF,
      baselineChanged
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

    if (subcmd === 'suggest-config') {
      console.error('session suggest-config 已移除。请用 architecture-rules.yaml / .av/layers.json，或手写 .importlinter（builtin 会直接评估）。');
      return EXIT.USAGE_ERROR;
    }

    if (subcmd === 'start') {
      if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
        console.error(`Repo path is not a directory (exit 2): ${repo}`);
        return EXIT.USAGE_ERROR;
      }
      const blocked = detectPathMismatch(repo, {
        confirm: args.confirmRepo === true || args['confirm-repo'] === true || args['confirm-repo'] === repo
      });
      if (blocked) {
        console.error(blocked.message);
        console.error('中止：未写入基线。确认路径后重跑，或加 --confirm-repo。');
        return EXIT.USAGE_ERROR;
      }
      fs.mkdirSync(avDir, { recursive: true });
      const graph = buildGraph(repo);
      const { toPersistableGraph } = require('./extract-graph');
      const { buildTestIndex } = require('./extract/test-index');
      const snapshot = {
        ...toPersistableGraph(graph),
        sessionStartedAt: new Date().toISOString(),
        testIndex: buildTestIndex(repo)
      };
      fs.writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2));
      const intentRec = writeSessionIntent(repo, args.intent, { sessionStartedAt: snapshot.sessionStartedAt });
      const cleared = clearStaleSessionReports(repo);
      console.log(`Checking repo:  ${repo}`);
      console.log(`Baseline saved to: ${baselinePath}`);
      if (intentRec && intentRec.text) {
        console.log(`Session intent: ${intentRec.text}`);
      }
      const gitRoot = findGitRoot(repo);
      if (gitRoot && !samePath(gitRoot, repo)) {
        console.log(`\n⚠ 注意：当前目录不是 Git 仓库根。`);
        console.log(`   检查目录:   ${repo}`);
        console.log(`   Git 根目录: ${gitRoot}`);
        console.log(`   基线与报告都基于「检查目录」。如果你在 worktree/子目录里改代码，确认这就是你要验收的目录。`);
      }
      if (isGitWorktree(repo)) {
        console.log(`\n⚠ 注意：当前检查目录是 Git worktree，不是主仓。`);
        console.log(`   检查目录:   ${repo}`);
        console.log(`   基线与报告都写在这个 worktree 的 .av/ 下，不会写到主仓。`);
      }
      // 硬编码路径检测：显式传了 repo 参数，但它和当前 shell 所在的 git 仓库不同。
      // 典型场景：人在 worktree 里改代码，却复制文档里的主仓路径来跑验收 → 报告假绿。
      const explicitRepoArg = !!args._[2];
      const shellCwd = process.cwd();
      const cwdGitRoot = findGitRoot(shellCwd);
      if (explicitRepoArg && cwdGitRoot
          && !samePath(cwdGitRoot, repo)
          && !samePath(shellCwd, repo)) {
        console.log(`\n⚠️ 警告：你传入的检查目录和当前 shell 所在仓库不一致！`);
        console.log(`   传入的检查目录: ${repo}`);
        console.log(`   Shell 工作目录: ${shellCwd}`);
        console.log(`   Shell Git 根:   ${cwdGitRoot}`);
        console.log(`   如果你正在 worktree 里改代码，请确认要验收的是哪个目录。`);
        console.log(`   不传路径直接跑 arch-viewer session start，会默认检查当前目录。`);
      }
      console.log(`Baseline recorded: ${graph.stats.files} files, ${graph.stats.types} types`);
      console.log(`Fingerprint: ${graph.fingerprint}`);
      if (cleared.deleted.length || cleared.stubbed.length) {
        if (cleared.deleted.length) {
          console.log(`Cleared stale session report: ${cleared.deleted.join(', ')}`);
        }
        if (cleared.stubbed.length) {
          // 删不掉（被占用/权限）时已覆写为过期存根：提示用户别误读旧红灯
          console.log(`Stale report neutralized (file locked, overwritten with EXPIRED marker): ${cleared.stubbed.join(', ')}`);
        }
      }
      const suggested = writeLayerSuggestions(repo, graph);
      if (suggested) {
        console.log(`Layer suggestions: ${suggested}`);
        console.log('  (自动分层推断，审阅即可；复制为 .av/layers.json 可锁定)');
      }
      console.log(`\nNow make your AI code changes, then run:`);
      console.log(`  arch-viewer session report`);
      console.log(`（CLI 不会持续自动监听；MCP 会话里才有防抖预生成。报告入口：.av/session-report.html）`);
      return 0;
    }
    if (subcmd === 'report') {
      let failOn;
      try {
        failOn = normalizeFailOn(args.failOn || args['fail-on']);
      } catch (e) {
        console.error(`Argument error (exit 2): ${e.message}`);
        return EXIT.USAGE_ERROR;
      }
      if (args.renderer && !['auto', 'archify', 'builtin'].includes(args.renderer)) {
        console.error(`Argument error (exit 2): --renderer must be auto|archify|builtin (got "${args.renderer}")`);
        return EXIT.USAGE_ERROR;
      }
      if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
        console.error(`Scan failed (exit 3): repo path is not a directory: ${repo}`);
        return EXIT.SCAN_FAILED;
      }
      const resolved = resolveSessionBaseline(repo);
      if (!resolved.ok) {
        if (resolved.error === 'SCAN_FAILED') {
          console.error(`Scan/report failed (exit 3): ${resolved.message}`);
          return EXIT.SCAN_FAILED;
        }
        console.error((resolved.message || 'No baseline found') + ' (exit 4).');
        return EXIT.NO_BASELINE;
      }
      const baseline = resolved.graph;
      const sessionStart = baseline.sessionStartedAt || baseline.cachedAt || null;
      let current;
      try {
        current = buildGraph(repo);
        require('./extract-graph').attachCallEdges(current, { incremental: true, base: baseline });
      } catch (e) {
        console.error(`Scan failed (exit 3): ${e.message}`);
        return EXIT.SCAN_FAILED;
      }
      const diff = diffGraphs(baseline, current);
      const impact = computeImpact(diff, baseline, current);
      let teamRules = null;
      try {
        teamRules = loadSessionRules(repo, args.rules);
      } catch (e) {
        console.error(`Rules config error (exit 2): ${e.message}`);
        return EXIT.USAGE_ERROR;
      }
      if (teamRules && teamRules._file) {
        console.log('Team rules: ' + teamRules._file + (teamRules.name ? ` (${teamRules.name})` : ''));
      }
      const { buildTestIndex } = require('./extract/test-index');
      const testIndexHead = buildTestIndex(repo);
      const { merged, sources: analyzerStatus } = require('./analyzers').runAnalyzers(repo, {
        current, baseline, diff, impact, rules: teamRules,
        testIndexBase: baseline.testIndex || null,
        testIndexHead
      });
      const completeness = assessAnalysisCompleteness(current);
      let findings = merged.violations;
      let riskSummary = summarizeFindings(findings);
      ({ findings, riskSummary } = applyCompletenessToRisk(findings, riskSummary, completeness));

      // W14-06: append local trend record (best-effort, never blocks gate)
      appendSessionHistory(repo, { baseline, current, diff, riskSummary });

      // Text output
      console.log(formatDiffText(diff, { all: !!args.all }));
      for (const source of analyzerStatus) {
        const status = !source.available ? `unavailable: ${source.error}`
          : !source.configured ? `not configured: ${source.error}`
            : source.error ? `ERROR: ${source.error}`
              : `${source.violations} findings`;
        console.log(`Analyzer ${source.id}: ${status}`);
      }
      if (!completeness.allowGreen) {
        console.error(completeness.message);
      }
      const findingsText = formatFindingsText(findings);
      if (findingsText) console.log(findingsText + '\n');
      const impactText = formatImpactText(impact);
      if (impactText) console.log(impactText + '\n');

      // Save JSON diff
      const reportJsonPath = path.join(avDir, 'session-report.json');
      let finalized;
      try {
        fs.writeFileSync(reportJsonPath, JSON.stringify(buildSessionReportJson({
          diff, findings, riskSummary, impact, analyzerStatus, baseGraph: baseline, headGraph: current,
          repoName: path.basename(repo), analysisCompleteness: completeness
        }), null, 2));

        const html = generateReport({
          baseGraph: baseline,
          headGraph: current,
          diff,
          findings,
          analyzerStatus,
          impact,
          repoName: path.basename(repo),
          sessionStart,
          analysisCompleteness: completeness
        });
        finalized = finalizeSessionHtml({
          repo,
          builtinHtml: html,
          renderer: args.renderer || require('./view-policy').DEFAULT_SESSION_RENDERER,
          archifyCli: args.archify
        });
      } catch (e) {
        console.error(`Scan/report write failed (exit 3): ${e.message}`);
        return EXIT.SCAN_FAILED;
      }
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
      const { formatSessionVerdict, nextStepForVerdict } = require('./session-verdict');
      const verdict = formatSessionVerdict({
        riskSummary,
        findings,
        summary: {
          ...diff.summary,
          implChangedCount: (diff.implChanges || []).length || diff.summary.implChangedCount || 0
        },
        scopeChanged: diff.scopeChanged || null,
        reportPath: htmlPath,
        baselineKind: resolved.kind,
        hasUncommitted: resolved.hasUncommitted,
        analysisCompleteness: completeness
      });
      console.log(`\n${verdict.text}`);
      if (!completeness.allowGreen) {
        console.log('先修复解析/扫描完整性，再重新 session report；不要把不完整结果当通过。');
      } else {
        console.log(nextStepForVerdict(verdict, {
          summary: { implChangedCount: (diff.implChanges || []).length },
          baselineKind: resolved.kind
        }));
      }
      if (args.open) {
        openInBrowser(htmlPath);
        console.log(`(已在默认浏览器打开 HTML 报告)`);
      }

      // 退出码契约：1 = 架构门未通过（报告已正常生成，不是崩溃）。
      // --fail-on 控制阈值：high（默认）/ medium / low / none（已在上方校验）。
      // failed / incomplete → exit 3（分析不可用，不是违规）。脚本看 analysisStatus。
      if (completeness.status === 'failed' || completeness.status === 'incomplete') {
        const label = completeness.status === 'failed' ? '分析失败' : '分析不完整';
        console.error(`\n${label}（exit 3）：${(completeness.reasons || []).join('；')}`);
        return exitCodeForAnalysis(completeness, riskSummary.gateLevel || riskSummary.level, failOn);
      }
      const gated = shouldGate(riskSummary.gateLevel || riskSummary.level, failOn);
      if (gated) {
        console.log(`\n⛔ 架构验收门未通过：${riskSummary.level.toUpperCase()} 风险达到 --fail-on=${failOn} 阈值，退出码 = 1。`);
        console.log(`   报告已正常生成（不是工具崩溃）。请先处理上面的红灯再提交。`);
        console.log(`   （CI 中退出码 1 阻断合并；用 --fail-on=medium/low 调严，--fail-on=none 只报告不阻断。）`);
      } else if (riskSummary.level !== 'none' && findings.length > 0) {
        // 有风险但未达阻断阈值（或 --fail-on=none 显式跳过门禁）
        const icon = riskSummary.level === 'high' ? '⛔' : riskSummary.level === 'medium' ? '🟠' : '🔵';
        console.log(`\n${icon} 检测到 ${riskSummary.level.toUpperCase()} 风险（${findings.length} 条 finding），但 --fail-on=${failOn} 阈值未触发阻断，退出码 = 0。`);
        if (failOn === 'none') {
          console.log(`   （--fail-on=none：只报告不阻断。CI 卡点请去掉此参数或设为 high/medium/low。）`);
        } else {
          console.log(`   建议审阅后再提交；如需更严格卡点，用 --fail-on=${riskSummary.level}。`);
        }
      } else {
        // 区分两种绿灯：零结构变化（函数体/注释改了也不报） vs 有结构变化但无风险
        const copy = require('./green-light').describeGreenLight(diff.summary);
        if (copy.kind === 'struct-ok') {
          console.log(`\n✅ 架构验收门通过：退出码 = 0，${copy.cli}`);
        } else {
          console.log(`\n✅ 架构验收门通过：退出码 = 0，${copy.cli}`);
          if (copy.kind === 'impl-only') {
            console.log(`   结构指纹只看类型 / import 边 / 分层；函数体变化见上方「实现差异」。请配合测试与代码审查。`);
          } else {
            console.log(`   结构指纹只看类型 / import 边 / 分层，函数体、日志字符串、注释不进指纹。`);
          }
        }
      }
      try {
        require('./pro/funnel').maybePaywallAfterValueMoment({
          findingsCount: findings.length,
          level: riskSummary.level,
          reason: 'session_risk'
        });
      } catch { /* ignore */ }
      return gated ? EXIT.GATE_FAILED : EXIT.OK;
    }
    if (subcmd === 'guard') {
      const { runGateViaCli, adaptGate, readStdinJson } = require('./session-gate');
      const adapter = args.adapter || 'generic';
      const event = readStdinJson();
      const gate = runGateViaCli(repo, {
        cliJs: path.join(__dirname, 'cli.js'),
        timeoutMs: Number(process.env.AV_HOOK_TIMEOUT_MS) || 90000
      });
      const adapted = adaptGate(gate, adapter, event);
      if (adapted.stderr) process.stderr.write(adapted.stderr);
      process.stdout.write(adapted.stdout || '{}\n');
      return adapted.exitCode == null ? 0 : adapted.exitCode;
    }
    if (subcmd === 'history') {
      const limit = Math.max(1, parseInt(args.lines, 10) || 10);
      const records = readSessionHistory(repo, limit);
      console.log(`=== 本地技术债趋势（最近 ${records.length} 次，.av/session-history.jsonl）===\n`);
      console.log(formatHistoryTable(records));
      return 0;
    }
    console.error('Usage: arch-viewer session start|report|guard|history [repo]');
    return 2;
  }
  if (cmd === 'archify-export') {
    const repo = path.resolve(args._[1] || process.cwd());
    if (!args.confirm) {
      console.error('Archify export requires --confirm after reviewing session-report evidence (exit 2). Typed JSON/schema/path existence does not prove a relation is true.');
      return EXIT.USAGE_ERROR;
    }
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
      console.error(res.message + ' (exit 4)');
      return EXIT.NO_BASELINE;
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
      if (res.validation.status === 'not_requested') {
        console.log('  validate: 未请求（IR 已写出，不是校验通过的成品）');
      } else if (res.validation.status === 'not_validated' || !res.validation.available) {
        console.log(`  validate: 未执行（${res.validation.message || '无 Archify CLI'}；不是校验通过的成品）`);
      } else {
        const v = res.validation;
        console.log(`  validate base: ${v.base.ok ? 'PASS' : 'FAIL ' + (v.base.codes || []).join(',')} [${v.status}]`);
        console.log(`  validate head: ${v.head.ok ? 'PASS' : 'FAIL ' + (v.head.codes || []).join(',')}`);
        if (!v.ok) {
          console.log('  → 校验未通过；IR 仍保留，不要当已验证成品。可用内置 session-report.html。');
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
        console.error(res.reason + ' (exit 2)');
        return EXIT.USAGE_ERROR;
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
        console.error(`未找到: ${key || ''} (exit 2)`);
        return EXIT.USAGE_ERROR;
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
        if (order[r.riskSummary.gateLevel || r.riskSummary.level] > order[worst]) {
          worst = r.riskSummary.gateLevel || r.riskSummary.level;
        }
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
      let wsFailOn;
      try {
        wsFailOn = normalizeFailOn(args.failOn || args['fail-on']);
      } catch (e) {
        console.error(`参数错误 (exit 2): ${e.message}`);
        return EXIT.USAGE_ERROR;
      }
      const wsGated = shouldGate(worst, wsFailOn);
      if (wsGated) {
        console.log(`\n⛔ 多仓验收门未通过：最高风险 ${worst.toUpperCase()} 达到 --fail-on=${wsFailOn} 阈值，退出码 = 1。`);
      }
      return wsGated ? EXIT.GATE_FAILED : EXIT.OK;
    }
    console.error('Usage: arch-viewer workspace add|list|remove|report ...');
    return EXIT.USAGE_ERROR;
  }

  if (cmd === 'auth') {
    const sub = args._[1];
    const authClient = require('./pro/auth-client');
    if (sub === 'login' || sub === 'trial') {
      const user = sub === 'trial'
        ? await authClient.startTrial({ email: args._[2], code: args.code })
        : await authClient.loginFlow({ email: args._[2], code: args.code });
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
        console.log('未登录 (exit 2)。运行 arch-viewer auth login 登录。');
        return EXIT.USAGE_ERROR;
      }
      console.log(`邮箱: ${user.email}`);
      console.log(`计划: ${user.plan}（${user.entitlement}，${user.active ? '有效' : '已到期'}）`);
      if (user.trialUntil) console.log(`试用至: ${String(user.trialUntil).slice(0, 10)}`);
      if (user.paidUntil) console.log(`Pro 至: ${String(user.paidUntil).slice(0, 10)}`);
      return EXIT.OK;
    }
    console.error('Usage: arch-viewer auth login|trial [email] [--code 123456] | whoami | logout');
    return EXIT.USAGE_ERROR;
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
    return EXIT.USAGE_ERROR;
  }

  if (cmd === 'setup') {
    // 一键接入：自动把架构检查工具装进已安装的 AI 编程工具
    const repoArg = args._[1] ? path.resolve(args._[1]) : null;
    // 只有 --project 才写本仓 hooks/规则；单独传 repo 路径只用于口令/欢迎文案
    const projectDir = args.project
      ? path.resolve(typeof args.project === 'string' ? args.project : (repoArg || process.cwd()))
      : null;
    let setup;
    try {
      setup = runSetup(projectDir ? { projectDir } : {});
    } catch (e) {
      console.error('安装失败 (exit 3)：' + e.message);
      return EXIT.SCAN_FAILED;
    }

    console.log('');
    console.log('================ 架构检查工具 · 一键安装 ================');
    console.log('');
    if (setup.launchMode === 'global') {
      console.log('  启动方式：全局安装（' + setup.serverPath + '，版本固定，不经 npx 重新解析）');
    } else {
      console.log('  启动方式：本地仓库（' + setup.serverPath + '）');
      console.log('  小提示：发布后可 npm i -g arch-viewer，再跑一次本命令即自动切换为全局安装模式');
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
      console.log('手动配置方法见：docs/guides/quickstart.md §0.2');
      return 0;
    }

    console.log('----------------------------------------------------------------');
    console.log('通用用法（Cursor / Claude / DeepSeek Harness / Windsurf）：');
    console.log('');
    console.log('  ① 重启 AI 工具，打开项目');
    console.log('  ② 对 AI 说：「改完用架构门检查一下」');
    console.log('  ③ Agent 应调用 av_guard；有 hook 的宿主会在停手时自动跑 session guard');
    console.log('');
    if (projectDir) {
      console.log('  已写入本仓强制层：.cursor/hooks.json · .claude/settings.json · AGENTS.md / CLAUDE.md');
      console.log('');
    } else {
      console.log('  想在本仓装 hooks/规则：arch-viewer setup . --project');
      console.log('');
    }
    console.log('--- 贴进 Rules / AGENTS.md 的口令 ---');
    console.log('');
    console.log(magicPrompt(repoArg));
    console.log('');
    console.log('----------------------------------------------------------------');

    // 自动打开可视化引导页
    const welcomePath = path.join(__dirname, '..', 'docs', 'guides', 'welcome.html');
    if (fs.existsSync(welcomePath) && !args['no-open']) {
      openInBrowser(welcomePath);
      console.log('（已在浏览器打开图文引导页，关了也没关系，文件在 docs/guides/welcome.html）');
    }
    console.log('');
    return failed.length > 0 ? EXIT.SCAN_FAILED : EXIT.OK;
  }

  if (cmd === 'uninstall') {
    const repoArg = args._[1] ? path.resolve(args._[1]) : null;
    let uninst;
    try {
      uninst = runUninstall({
        projectDir: repoArg,
        npm: !!args.npm,
        purge: !!args.purge
      });
    } catch (e) {
      console.error('卸载失败 (exit 3)：' + e.message);
      return EXIT.SCAN_FAILED;
    }

    console.log('');
    console.log('================ 架构检查工具 · 卸载 ================');
    console.log('');
    console.log('  只移除 Architecture Viewer 的接入配置，其它 MCP / 业务代码不动。');
    if (!repoArg) {
      console.log('  本仓 hooks 未动。要卸项目级：arch-viewer uninstall .');
    }
    if (!args.purge) {
      console.log('  未删 .av/ 报告与快照。要清会话产物：加上 --purge（仍保留 layers.json）。');
    }
    if (!args.npm) {
      console.log('  未卸全局 npm 包。要连 CLI 一起卸：加上 --npm。');
    }
    console.log('');

    const removed = uninst.results.filter(r => r.status === 'removed');
    const already = uninst.results.filter(r => r.status === 'already');
    const skipped = uninst.results.filter(r => r.status === 'not-installed' || r.status === 'skipped');
    const failed = uninst.results.filter(r => r.status === 'error');

    for (const r of removed) {
      console.log(`  ✅ ${r.name}：已卸${r.note ? '（' + r.note + '）' : ''}`);
    }
    for (const r of already) {
      console.log(`  ⏭️  ${r.name}：本来就没有，跳过`);
    }
    for (const r of skipped) {
      console.log(`  ⬜  ${r.name}：跳过（${r.detail}）`);
    }
    for (const r of failed) {
      console.log(`  ❌ ${r.name}：失败（${r.detail}）`);
    }
    console.log('');
    console.log('----------------------------------------------------------------');
    console.log('之后请完全退出并重开 Cursor / Claude / DeepSeek Harness。');
    console.log('再装：arch-viewer setup    本仓 hooks：arch-viewer setup . --project');
    console.log('----------------------------------------------------------------');
    console.log('');
    return failed.length > 0 ? EXIT.SCAN_FAILED : EXIT.OK;
  }

  console.error('Unknown command: ' + cmd);
  help();
  return EXIT.USAGE_ERROR;
}

if (require.main === module) {
  const telemetry = require('./telemetry');
  const argv = process.argv.slice(2);
  const cmdName = argv[0] || 'help';
  telemetry.wrap(cmdName, () => main(argv)).then(
    (code) => process.exit(code || 0),
    (err) => {
      // 未捕获异常 = 扫描/解析/运行时失败（退出码 3），不是架构门拦截（1）。
      console.error(`运行时错误 (exit 3): ${err.message || err}`);
      process.exit(EXIT.SCAN_FAILED);
    }
  );
}

module.exports = { main, runEval };
