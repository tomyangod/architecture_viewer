'use strict';

/**
 * Architecture Viewer MCP Server
 *
 * 暴露 8 个工具给 AI Agent（Cursor / Claude / DeepSeek Harness / Windsurf…）：
 *   av_guard           — 日常结构门：ensure 基线 + 本轮 verdict（优先）
 *   av_session_start    — AI 改代码前记录快照基线（高级 / 无 git）
 *   av_session_changes  — 轻量：有没有架构变更
 *   av_session_report   — 完整报告（与 av_guard 同级 verdict；HTML 可选）
 *   av_status           — 基线 / 监听 / 缓存 / 是否过期（给人看）
 *   av_check_layering   — 实时检测当前代码的跨层违规（不需要基线）
 *   av_explain_finding  — 解释一条违规的结构化事实
 *   av_archify_export   — 导出 Archify IR 稀疏图（可选顺带 archify validate）
 *
 * 刻意不暴露图谱查询工具（谁依赖谁）——那是 codebase-memory-mcp 的主场。
 * AV 给 Agent 的是判断和结论，不是原材料。
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings, LAYER_LABEL, loadSessionRules, suggestForFinding } = require('../lib/risk-rules');
const { writeSessionIntent } = require('../lib/session-intent');
const { computeImpact } = require('../lib/impact');
const { generateReport, appendSessionHistory, clearStaleSessionReports, buildSessionReportJson, isStaleReport } = require('../lib/session-report');
const { migrateReport } = require('../lib/report-contract');
const { exportArchify, finalizeSessionHtml } = require('../lib/archify-export');
const { exitCodeForRisk } = require('../lib/exit-codes');
const { runAnalyzers } = require('../lib/analyzers');
const { describeGreenLight } = require('../lib/green-light');
const { formatSessionVerdict, nextStepForVerdict } = require('../lib/session-verdict');
const { sessionPaths, detectPathMismatch, isGitWorktree } = require('../lib/session-paths');
const { resolveSessionBaseline, ensureSessionBaseline, noBaselinePayload, headCachePath } = require('../lib/session-baseline');
const PKG_VERSION = require('../package.json').version;

/**
 * Resolve the repo to check.
 * MCP hosts do not guarantee that process.cwd() is the active IDE workspace.
 * Fail closed unless the caller supplies the absolute workspace root.
 */
function resolveRepo(args) {
  const raw = args && typeof args.repo === 'string' ? args.repo.trim() : '';
  if (!raw) {
    throw new Error('repo is required and must be the absolute path of the active workspace root');
  }
  if (!path.isAbsolute(raw)) {
    throw new Error(`repo must be an absolute path: ${raw}`);
  }
  const repo = path.resolve(raw);
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
  return repo;
}

/** Default 8s; override with AV_SESSION_DEBOUNCE_MS or .av/session.json debounceSeconds. */
const DEFAULT_DEBOUNCE_MS = 8000;

function resolveDebounceMs(repo) {
  const env = process.env.AV_SESSION_DEBOUNCE_MS;
  if (env != null && String(env).trim() !== '') {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 1000) return Math.round(n);
  }
  try {
    const cfgPath = path.join(repo, '.av', 'session.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (typeof cfg.debounceMs === 'number' && cfg.debounceMs >= 1000) {
        return Math.round(cfg.debounceMs);
      }
      if (typeof cfg.debounceSeconds === 'number' && cfg.debounceSeconds >= 1) {
        return Math.round(cfg.debounceSeconds * 1000);
      }
    }
  } catch { /* ignore bad config */ }
  return DEFAULT_DEBOUNCE_MS;
}

function avDir(repo) {
  return path.join(repo, '.av');
}

function baselinePath(repo) {
  return path.join(avDir(repo), 'graph-baseline.json');
}

function pathGuard(repo, args) {
  return detectPathMismatch(repo, {
    editDir: args && args.editDir,
    confirmRepo: args && args.confirmRepo
  });
}

/** Structure/content peek without writing HTML (for idle race and av_status). */
function peekSessionDiff(repo) {
  const resolved = resolveSessionBaseline(repo);
  if (!resolved.ok) return null;
  const baseline = resolved.graph;
  const current = buildGraph(repo);
  return {
    structChanged: current.fingerprint !== baseline.fingerprint,
    contentChanged: (current.contentFingerprint || null) !== (baseline.contentFingerprint || null),
    baseFingerprint: baseline.fingerprint || null,
    headFingerprint: current.fingerprint || null,
    sessionStartedAt: baseline.sessionStartedAt || baseline.cachedAt || null,
    baselineKind: resolved.kind,
    hasUncommitted: resolved.hasUncommitted
  };
}

// ─── 自动闭环：文件监听 + 防抖自动报告（仅 MCP/长期进程）────────
// CLI 的 session start 不会挂监听；改完请手动 session report。
// MCP 里 AI 连续写文件时，静默 debounceMs 后预生成报告；
// av_session_report 会取消防抖并立即重算。

const WATCH_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.vue', '.svelte', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', '.av', 'dist', 'build', '.next', 'coverage', '__pycache__', '.idea', '.vscode', '.trae']);

/** repoPath -> { watcher, timer, autoReport, watching, pendingFiles, debounceMs, debounceDeadline } */
const watchers = new Map();

function shouldWatchFile(filePath) {
  const ext = path.extname(filePath);
  if (!WATCH_EXTENSIONS.has(ext)) return false;
  const parts = filePath.split(path.sep);
  return !parts.some((p) => IGNORE_DIRS.has(p));
}

/**
 * 核心报告生成逻辑（watcher 和手动调用共用）。
 * 生成 diff + 风险 + 影响面 + HTML/JSON 文件，返回结构化结果。
 */
function generateSessionReport(repo) {
  try {
    return generateSessionReportUnsafe(repo);
  } catch (e) {
    return {
      error: 'SCAN_FAILED',
      message: '扫描当前仓库失败：' + (e && e.message ? e.message : String(e)),
      nextStep: '确认仓库路径可读后重试 av_session_report / av_guard。'
    };
  }
}

function generateSessionReportUnsafe(repo) {
  const resolved = resolveSessionBaseline(repo);
  if (!resolved.ok) {
    if (resolved.error === 'SCAN_FAILED') {
      return { error: 'SCAN_FAILED', message: resolved.message, nextStep: resolved.nextStep };
    }
    return null;
  }
  const baseline = resolved.graph;
  const sessionStart = baseline.sessionStartedAt || baseline.cachedAt || null;
  const current = buildGraph(repo);
  require('../lib/extract-graph').attachCallEdges(current, { incremental: true, base: baseline });
  const diff = diffGraphs(baseline, current);
  const impact = computeImpact(diff, baseline, current);
  const teamRules = loadSessionRules(repo);
  const { buildTestIndex } = require('../lib/extract/test-index');
  const testIndexHead = buildTestIndex(repo);
  const { merged, sources: analyzerStatus } = runAnalyzers(repo, {
    current, baseline, diff, impact, rules: teamRules,
    testIndexBase: baseline.testIndex || null,
    testIndexHead
  });
  const findings = merged.violations;
  const externalAdded = findings.filter(f => f.sourceAnalyzer !== 'builtin' && !f.secondarySource).length;

  const riskSummary = summarizeFindings(findings);

  // W14-06: append local trend record (best-effort, never blocks report)
  appendSessionHistory(repo, { baseline, current, diff, riskSummary });

  const dir = avDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const reportJsonPath = path.join(dir, 'session-report.json');
  fs.writeFileSync(reportJsonPath, JSON.stringify(buildSessionReportJson({
    diff, findings, riskSummary, impact, analyzerStatus, baseGraph: baseline, headGraph: current,
    repoName: path.basename(repo)
  }), null, 2));
  const html = generateReport({
    baseGraph: baseline, headGraph: current, diff, findings, impact, analyzerStatus,
    repoName: path.basename(repo), sessionStart
  });
  const finalized = finalizeSessionHtml({ repo, builtinHtml: html });

  return {
    generatedAt: Date.now(),
    summary: {
      ...diff.summary,
      baseFingerprint: diff.base.fingerprint,
      headFingerprint: diff.head.fingerprint,
      // Authoritative findings severity (same as top-level riskLevel).
      // diff.summary.changeScale is the volume heuristic and must not be read as risk.
      riskLevel: riskSummary.level,
      riskCount: findings.length,
      riskCounts: riskSummary.counts
    },
    findings: findings.map(formatFinding),
    impact: formatImpact(impact),
    reportPaths: {
      json: reportJsonPath,
      html: finalized.htmlPath,
      builtinHtml: finalized.builtinPath,
      renderer: finalized.renderer.used,
      rendererReason: finalized.renderer.reason
    },
    riskLevel: riskSummary.level,
    findingsCount: findings.length,
    hasChanges: (diff.summary.totalChanges || 0) > 0,
    implementation: {
      count: (diff.implChanges || []).length,
      changes: (diff.implChanges || []).slice(0, 20).map((c) => ({
        symbol: c.owner ? `${c.owner}.${c.method}` : (c.method || c.name),
        change: c.change,
        path: c.path || null,
        addedLiterals: c.addedLiterals || [],
        removedLiterals: c.removedLiterals || []
      }))
    },
    analyzerStatus,
    externalAdded,
    exitCode: exitCodeForRisk(riskSummary.gateLevel || riskSummary.level, 'high'),
    exitCodeHint: '默认 high→1 阻断，medium/low/none→0。CLI 可用 --fail-on 调整。reportOnly 观察期 finding 不计入 gateLevel。',
    ...(() => {
      const verdict = formatSessionVerdict({
        riskSummary,
        findings,
        summary: {
          ...diff.summary,
          implChangedCount: (diff.implChanges || []).length || diff.summary.implChangedCount || 0
        },
        reportPath: finalized.htmlPath,
        baselineKind: resolved.kind,
        hasUncommitted: resolved.hasUncommitted
      });
      return {
        baselineKind: resolved.kind,
        gitHead: resolved.gitHead || null,
        hasUncommitted: !!resolved.hasUncommitted,
        verdict: {
          level: verdict.level,
          lines: verdict.lines,
          text: verdict.text,
          reportPath: verdict.reportPath,
          topFinding: verdict.topFinding
            ? {
              rule: verdict.topFinding.rule || null,
              severity: verdict.topFinding.severity || null,
              title: verdict.topFinding.title || null,
              file: verdict.topFinding.file || null,
              line: verdict.topFinding.line != null ? verdict.topFinding.line : null
            }
            : null
        },
        message: verdict.text,
        nextStep: nextStepForVerdict(verdict, {
          summary: { implChangedCount: (diff.implChanges || []).length },
          baselineKind: resolved.kind
        })
      };
    })()
  };
}

/** 启动文件监听：AI 改代码后自动生成报告（仅长期运行的 MCP 进程有效） */
function startWatcher(repo) {
  // 已在监听则先停掉旧的（重新 start 时重置）
  stopWatcher(repo);

  const debounceMs = resolveDebounceMs(repo);
  const debounceSec = Math.round(debounceMs / 1000);
  const state = {
    watcher: null,
    timer: null,
    autoReport: null,
    watching: true,
    pendingFiles: 0,
    debounceMs,
    debounceSec,
    debounceDeadline: null
  };

  try {
    const watcher = fs.watch(repo, { recursive: true }, (_event, filename) => {
      if (!filename || !shouldWatchFile(filename)) return;
      state.pendingFiles++;
      // 重置防抖计时器
      if (state.timer) clearTimeout(state.timer);
      state.debounceDeadline = Date.now() + state.debounceMs;
      state.timer = setTimeout(() => {
        state.timer = null;
        state.pendingFiles = 0;
        state.debounceDeadline = null;
        try {
          const report = generateSessionReport(repo);
          if (report) state.autoReport = report;
        } catch (e) {
          // 自动报告失败不崩溃，手动 report 时会再试
          state.autoReport = { error: e.message, generatedAt: Date.now() };
        }
      }, state.debounceMs);
      // 定时器不阻止进程退出（MCP server 靠 stdio 保活）
      state.timer.unref?.();
    });
    // watcher 不阻止进程退出（测试/CLI 场景下不挂住）
    watcher.unref?.();
    state.watcher = watcher;
  } catch (e) {
    // fs.watch recursive 在某些 Linux 环境不支持——降级为不监听（手动 report 仍可用）
    state.watching = false;
    state.watchError = e.message;
  }

  watchers.set(repo, state);
  return state;
}

/** Cancel pending debounce. Returns whether a pending analysis was cancelled. */
function flushWatcherDebounce(repo) {
  const state = watchers.get(repo);
  if (!state) return { state: null, hadPending: false };
  const hadPending = !!(state.timer || state.pendingFiles > 0);
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.pendingFiles = 0;
  state.debounceDeadline = null;
  return { state, hadPending };
}

function stopWatcher(repo) {
  const state = watchers.get(repo);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  if (state.watcher) {
    try { state.watcher.close(); } catch { /* ignore */ }
  }
  watchers.delete(repo);
}

function getWatcherState(repo) {
  return watchers.get(repo) || null;
}

// 进程退出时清理所有 watcher
process.on('exit', () => {
  for (const repo of watchers.keys()) stopWatcher(repo);
});

function writeLayerSuggestions(repo, graph) {
  const dir = avDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const suggestedPath = path.join(dir, 'layers.suggested.json');
  if (graph.layerSignals && Object.keys(graph.layerSignals).length > 0) {
    fs.writeFileSync(suggestedPath, JSON.stringify(graph.layerSignals, null, 2));
    return suggestedPath;
  }
  return null;
}

function formatFinding(f) {
  const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : f.severity === 'low' ? '🔵' : '⚪';
  return {
    rule: f.rule,
    severity: f.severity,
    title: f.title,
    message: f.message,
    detail: f.detail || null,
    suggestion: f.suggestion || null,
    file: f.file || null,
    line: f.line || null,
    sourceAnalyzer: f.sourceAnalyzer || 'builtin',
    confidence: f.confidence || 'medium',
    ...(f.secondarySource ? { secondarySource: f.secondarySource } : {}),
    text: `${icon} [${f.severity.toUpperCase()}] ${f.title}: ${f.message}\n   ${f.detail || ''}`
  };
}

function formatImpact(impact) {
  if (!impact || !impact.items || impact.items.length === 0) return '没有波及范围数据';
  const changed = impact.changedCount ?? impact.summary?.changed ?? 0;
  const affected = impact.impactedCount ?? impact.summary?.affected ?? 0;
  const lines = [`改了 ${changed} 个地方，会波及 ${affected} 个其他地方`];
  for (const it of impact.items.slice(0, 5)) {
    const direct = (it.direct || []).length;
    const transitive = (it.transitive || []).length;
    lines.push(`  • [${it.change}] ${it.id} → 直接受影响 ${direct}，间接受影响 ${transitive}`);
  }
  return lines.join('\n');
}

function toolSessionStart(args) {
  const repo = resolveRepo(args);
  const blocked = pathGuard(repo, args);
  if (blocked) return blocked;
  fs.mkdirSync(avDir(repo), { recursive: true });
  const graph = buildGraph(repo);
  const { toPersistableGraph } = require('../lib/extract-graph');
  const { buildTestIndex } = require('../lib/extract/test-index');
  const snapshot = {
    ...toPersistableGraph(graph),
    sessionStartedAt: new Date().toISOString(),
    testIndex: buildTestIndex(repo)
  };
  fs.writeFileSync(baselinePath(repo), JSON.stringify(snapshot, null, 2));
  const intentRec = writeSessionIntent(repo, args.intent, { sessionStartedAt: snapshot.sessionStartedAt });
  const clearedResult = clearStaleSessionReports(repo);
  const clearedReports = [...clearedResult.deleted, ...clearedResult.stubbed];
  const suggested = writeLayerSuggestions(repo, graph);

  // 启动文件监听：仅 MCP 长期进程有效；CLI session start 不走这里
  const watchState = startWatcher(repo);
  const debounceSec = watchState.debounceSec || Math.round(DEFAULT_DEBOUNCE_MS / 1000);

  const pathInfo = sessionPaths(repo);
  pathInfo.repoSource = 'arg';
  pathInfo.mismatch = !!(pathInfo.gitRoot && path.resolve(pathInfo.gitRoot) !== path.resolve(repo));
  pathInfo.cwdMismatch = path.resolve(repo) !== pathInfo.cwd;

  const warnLines = [
    `实际修改/检查目录：${pathInfo.checking}`,
    `基线所在目录：${pathInfo.baselineDir}`,
    `报告所在目录：${pathInfo.reportDir}`,
    `报告入口：${pathInfo.reportEntry}`,
    `MCP 进程 cwd：${pathInfo.cwd}`,
    '必须在最终回复中同时回显以上三个目录；不一致则中止，不要当验收通过。'
  ];
  if (pathInfo.mismatch) {
    warnLines.push(
      `⚠ 检查目录不是 Git 根：Git 根 = ${pathInfo.gitRoot}`,
      '基线与报告都基于「检查目录」。'
    );
  }
  if (isGitWorktree(repo) || pathInfo.worktree) {
    warnLines.push(
      '⚠ 当前检查目录是 Git worktree，不是主仓。基线与报告写在这个 worktree 的 .av/ 下，不会写到主仓。'
    );
  }

  return {
    path: pathInfo,
    pathWarning: warnLines.join('\n'),
    baseline: {
      files: graph.stats.files,
      types: graph.stats.types,
      edges: graph.stats.edges,
      externalPackages: graph.stats.externalPackages,
      fingerprint: graph.fingerprint,
      savedTo: baselinePath(repo)
    },
    autoWatch: watchState.watching
      ? `已开启自动监听（仅 MCP/扩展进程）：停下约 ${debounceSec} 秒后预生成报告。不想等请直接调 av_session_report（立即重算）。CLI 的 session start 不会持续监听，改完请手动 session report。`
      : `自动监听不可用（${watchState.watchError || '当前环境不支持'}），改完代码后请手动调 av_session_report。`,
    debounceSeconds: debounceSec,
    layerSuggestions: suggested
      ? { path: suggested, note: '工具自动帮你分好了楼层。觉得没问题就不用管；想锁定就复制为 .av/layers.json' }
      : null,
    clearedReports,
    intent: intentRec && intentRec.text ? intentRec.text : null,
    message: `已经拍好了"改之前"的照片（${graph.stats.files} 个文件、${graph.stats.types} 个组件）。请在最终回复中回显：实际修改目录、基线目录、报告目录。现在开始改代码；改完后优先调 av_session_report（不必等防抖），也可先用 av_session_changes。看状态用 av_status。报告确认无误后，再调 av_session_start 刷新基线，开始下一轮。`,
    nextStep: '让 AI 改代码。改完后直接调 av_session_report 看完整报告和红灯（会取消防抖立即生成）；确认报告无误后，再调 av_session_start 刷新基线。'
  };
}

function toolSessionReport(args) {
  const repo = resolveRepo(args);
  const blocked = pathGuard(repo, args);
  if (blocked) return blocked;

  // 手动 report：若防抖还在等，立刻取消并重算（不必干等 8 秒）
  const { state, hadPending } = flushWatcherDebounce(repo);
  const live = state || getWatcherState(repo);

  // Contract/config/binary changes are not all watched. Explicit acceptance
  // always rechecks; autoReport remains useful for lightweight status polling.
  const report = generateSessionReport(repo);
  if (!report) return noBaselinePayload();
  if (report.error) return report;
  if (live) live.autoReport = report;
  return hadPending ? { ...report, flushedDebounce: true } : report;
}

/**
 * Daily architecture gate for any MCP host (Cursor / Claude / DeepSeek / …).
 * Ensures a baseline when missing, then returns the same verdict surface as report.
 */
function toolSessionGuard(args) {
  const repo = resolveRepo(args);
  const blocked = pathGuard(repo, args);
  if (blocked) return blocked;

  let ensured = false;
  try {
    const ensuredRes = ensureSessionBaseline(repo);
    ensured = !!ensuredRes.ensured;
    if (!ensuredRes.ok) {
      return {
        error: ensuredRes.error || 'NO_BASELINE',
        message: ensuredRes.message,
        nextStep: ensuredRes.nextStep,
        ensured
      };
    }
  } catch (e) {
    return {
      error: 'SCAN_FAILED',
      message: '自动建立基线失败：' + (e.message || String(e)),
      nextStep: '检查仓库路径与扫描依赖后重试 av_guard。',
      ensured
    };
  }

  const { state, hadPending } = flushWatcherDebounce(repo);
  const live = state || getWatcherState(repo);
  const report = generateSessionReport(repo);
  if (!report) return { ...noBaselinePayload(), ensured };
  if (report.error) return { ...report, ensured };
  if (live) live.autoReport = report;

  const out = {
    ...report,
    ensured,
    tool: 'av_guard',
    gate: true
  };
  if (hadPending) out.flushedDebounce = true;
  if (ensured) {
    out.ensureNote = '已自动建立结构基线（无 git 时写入 .av/graph-baseline.json；有 git 时对照 HEAD）。';
  }
  return out;
}

/**
 * 轻量检查：不生成 HTML 文件，只返回"有没有架构变更、风险等级"。
 * AI 在每次完成代码修改、回复用户前调用，成本极低。
 * 如果 watcher 正在防抖（检测到变更但还没跑完），返回 analyzing 状态。
 */
function toolSessionChanges(args) {
  const repo = resolveRepo(args);
  const blocked = pathGuard(repo, args);
  if (blocked) return blocked;
  const resolved = resolveSessionBaseline(repo);
  if (!resolved.ok) {
    return resolved.error === 'SCAN_FAILED'
      ? { error: 'SCAN_FAILED', message: resolved.message, nextStep: resolved.nextStep }
      : noBaselinePayload();
  }

  const state = getWatcherState(repo);
  const debounceSec = (state && state.debounceSec) || Math.round(DEFAULT_DEBOUNCE_MS / 1000);

  // watcher 正在防抖（检测到文件变更，等待 AI 停下）
  if (state && state.timer) {
    const remainingMs = Math.max(0, (state.debounceDeadline || Date.now()) - Date.now());
    const remainingSec = Math.ceil(remainingMs / 1000);
    return {
      watching: true,
      status: 'analyzing',
      hasChanges: true,
      debounceSeconds: debounceSec,
      remainingSec,
      message: `检测到代码变更，防抖还剩约 ${remainingSec} 秒（默认 ${debounceSec}s）。不想等请直接调 av_session_report——会取消防抖并立即生成报告。`,
      nextStep: '直接调 av_session_report 立即看完整报告；或稍等防抖结束后再调。'
    };
  }

  // 有自动生成的报告
  if (state && state.watching && state.watcher && state.autoReport && !state.autoReport.error) {
    const r = state.autoReport;
    const ageSec = Math.round((Date.now() - r.generatedAt) / 1000);
    return {
      watching: true,
      status: 'ready',
      hasChanges: r.hasChanges,
      riskLevel: r.riskLevel,
      findingsCount: r.findingsCount,
      summary: r.summary,
      cacheAgeSec: ageSec,
      message: r.hasChanges
        ? `${r.message} 报告已自动生成（${ageSec} 秒前），调 av_session_report 看完整报告和架构图。`
        : describeGreenLight(r.summary).mcpShort,
      nextStep: r.hasChanges
        ? '调 av_session_report 看完整报告和架构图。'
        : '确认变更符合预期后，调 av_session_start 刷新基线。'
    };
  }

  // watcher 在监听但还没检测到变更——不轻信 idle：fs.watch 可能尚未到达
  if (state && state.watching) {
    const peek = peekSessionDiff(repo);
    if (peek && peek.structChanged) {
      return {
        watching: true,
        status: 'ready',
        hasChanges: true,
        peeked: true,
        watchLag: true,
        debounceSeconds: debounceSec,
        summary: {
          baseFingerprint: peek.baseFingerprint,
          headFingerprint: peek.headFingerprint
        },
        message: 'watcher 事件可能尚未到达，但实时指纹已确认结构有变更。不要当成「没有变化」。请直接调 av_session_report（会立即重算）。',
        nextStep: '直接调 av_session_report 看完整报告。'
      };
    }
    return {
      watching: true,
      status: 'idle',
      hasChanges: false,
      peeked: true,
      contentChanged: !!(peek && peek.contentChanged),
      debounceSeconds: debounceSec,
      message: peek && peek.contentChanged
        ? `结构指纹未变，但源码内容变了（函数体/注释不进结构指纹）。watcher 事件也可能尚未到达；若刚写完文件，可等 0.5–1 秒再问，或直接调 av_session_report。`
        : `正在监听中，实时指纹与基线一致。若刚刚写完文件，watcher 事件可能尚未到达——可等 0.5–1 秒再调 av_session_changes，或直接调 av_session_report。`,
      nextStep: '改完代码后直接调 av_session_report，或稍后再调 av_session_changes。'
    };
  }

  // 没有 watcher（可能 server 重启过 / CLI 场景）：实时快速检查
  const report = generateSessionReport(repo);
  if (!report) {
    return { watching: false, status: 'no-baseline', hasChanges: false, ...noBaselinePayload() };
  }
  if (report.error) {
    return { watching: false, status: 'error', hasChanges: false, ...report };
  }
  return {
    watching: false,
    status: 'ready',
    hasChanges: report.hasChanges,
    riskLevel: report.riskLevel,
    findingsCount: report.findingsCount,
    summary: report.summary,
    message: report.hasChanges
      ? `${report.message} 调 av_session_report 看完整报告和架构图。`
      : describeGreenLight(report.summary).mcpShort,
    nextStep: report.nextStep || (report.hasChanges
      ? '调 av_session_report 看完整报告和架构图。'
      : '确认变更符合预期后，调 av_session_start 刷新基线。')
  };
}

function toolSessionStatus(args) {
  const repo = resolveRepo(args);
  const blocked = pathGuard(repo, args);
  if (blocked) return { ...blocked, watching: false };
  const paths = sessionPaths(repo);
  const resolved = resolveSessionBaseline(repo);
  const hasBaseline = !!(resolved.ok);
  const baseline = resolved.ok ? resolved.graph : null;
  const bp = resolved.ok && resolved.kind === 'git-head'
    ? (resolved.cachePath || headCachePath(repo))
    : baselinePath(repo);
  const reportJsonPath = path.join(avDir(repo), 'session-report.json');
  const reportHtmlPath = paths.reportEntry;
  let report = null;
  let reportStale = false;
  if (fs.existsSync(reportJsonPath)) {
    try {
      report = migrateReport(JSON.parse(fs.readFileSync(reportJsonPath, 'utf8')));
      reportStale = isStaleReport(report)
        || !!(baseline && report.baseFingerprint && baseline.fingerprint && report.baseFingerprint !== baseline.fingerprint);
    } catch { /* ignore */ }
  }
  const state = getWatcherState(repo);
  const debounceSec = (state && state.debounceSec) || Math.round(DEFAULT_DEBOUNCE_MS / 1000);
  let remainingSec = null;
  if (state && state.timer && state.debounceDeadline) {
    remainingSec = Math.max(0, Math.ceil((state.debounceDeadline - Date.now()) / 1000));
  }
  const peek = hasBaseline ? peekSessionDiff(repo) : null;
  const cacheAgeSec = state && state.autoReport && state.autoReport.generatedAt
    ? Math.round((Date.now() - state.autoReport.generatedAt) / 1000)
    : null;
  const watching = !!(state && state.watching && state.watcher);
  const reportFresh = !!(report && !reportStale && fs.existsSync(reportHtmlPath));
  return {
    version: PKG_VERSION,
    path: paths,
    baseline: hasBaseline
      ? {
          present: true,
          kind: resolved.kind,
          savedTo: bp,
          gitHead: resolved.gitHead || null,
          hasUncommitted: !!resolved.hasUncommitted,
          sessionStartedAt: baseline && (baseline.sessionStartedAt || baseline.cachedAt) || null,
          fingerprint: baseline && baseline.fingerprint || null,
          files: baseline && baseline.stats && baseline.stats.files || null
        }
      : { present: false, savedTo: bp },
    watcher: {
      running: watching,
      repo: watching ? repo : null,
      debounceSeconds: debounceSec,
      pendingFiles: state ? state.pendingFiles || 0 : 0,
      remainingSec,
      lastError: state && state.watchError || null
    },
    report: {
      html: reportHtmlPath,
      json: reportJsonPath,
      exists: reportFresh || fs.existsSync(reportHtmlPath),
      stale: reportStale || (hasBaseline && fs.existsSync(reportHtmlPath) && !report),
      generatedAt: report && report.generatedAt || null,
      riskLevel: report && (report.risk && report.risk.level || report.riskSummary && report.riskSummary.level) || null,
      cached: !!(state && state.autoReport && !state.autoReport.error),
      cacheAgeSec
    },
    peek: peek
      ? {
          structChanged: peek.structChanged,
          contentChanged: peek.contentChanged,
          baseFingerprint: peek.baseFingerprint,
          headFingerprint: peek.headFingerprint
        }
      : null,
    message: !hasBaseline
      ? (resolved.message || noBaselinePayload().message)
      : reportStale
        ? '基线已刷新或报告过期，不要打开旧 HTML。请调 av_session_report 生成最新报告。'
        : watching
          ? `基线在 ${paths.baselineDir}；正在监听 ${repo}。${peek && peek.structChanged ? '实时指纹已变，请调 av_session_report。' : remainingSec != null ? `防抖还剩约 ${remainingSec} 秒。` : '可调 av_session_changes 或直接 av_session_report。'}`
          : '基线已建立，自动监听未运行（CLI 或 watcher 不可用）。改完请手动 av_session_report。',
    nextStep: !hasBaseline
      ? (resolved.nextStep || noBaselinePayload().nextStep)
      : peek && peek.structChanged
        ? '调 av_session_report 看完整报告。'
        : (resolved.kind === 'git-head'
          ? '改完后调 av_session_report；commit 即接受当前结构。'
          : '改完后调 av_session_report；确认无误后再 av_session_start 刷新基线。')
  };
}

function toolCheckLayering(args) {
  const repo = resolveRepo(args);
  const graph = buildGraph(repo);

  const emptyBase = { nodes: [], edges: [], fingerprint: '', root: graph.root, stats: {} };
  const diff = diffGraphs(emptyBase, graph);
  const findings = evaluateRisk(diff, graph, emptyBase, null);
  const riskSummary = summarizeFindings(findings);

  const layered = graph.nodes.filter(n => n.layer && n.kind !== 'file' && n.kind !== 'external');
  const total = graph.nodes.filter(n => n.kind !== 'file' && n.kind !== 'external');
  const layerDist = {};
  for (const n of layered) {
    layerDist[n.layer] = (layerDist[n.layer] || 0) + 1;
  }

  return {
    repo: graph.root,
    fingerprint: graph.fingerprint,
    stats: graph.stats,
    layerCoverage: {
      layered: layered.length,
      total: total.length,
      coverage: total.length > 0 ? `${Math.round(layered.length / total.length * 100)}%` : '0%'
    },
    layerDistribution: layerDist,
    riskLevel: riskSummary.level,
    riskCount: findings.length,
    findings: findings.map(formatFinding),
    message: riskSummary.level === 'none'
      ? `✅ 没有串门 — ${layered.length}/${total.length} 个组件已分到楼层（${total.length > 0 ? Math.round(layered.length / total.length * 100) : 0}%）。`
      : `查到 ${findings.length} 个问题（${riskSummary.level === 'high' ? '红灯' : riskSummary.level === 'medium' ? '黄灯' : '蓝灯'}），这是全楼历史问题，不是这次改出来的。`
  };
}

function pickFinding(findings, args) {
  return (findings || []).find((f, i) => {
    if (typeof f === 'string') return false;
    return (args.rule && f.rule === args.rule) ||
           (args.index !== undefined && i === args.index);
  });
}

function liveScanFindings(repo) {
  const graph = buildGraph(repo);
  const emptyBase = { nodes: [], edges: [], fingerprint: '', root: graph.root, stats: {} };
  const diff = diffGraphs(emptyBase, graph);
  const impact = computeImpact(diff, emptyBase, graph);
  let teamRules = null;
  try { teamRules = loadSessionRules(repo); } catch { /* ignore */ }
  const findings = evaluateRisk(diff, graph, emptyBase, impact, { rules: teamRules });
  return { graph, baseline: emptyBase, diff, impact, findings };
}

function loadSessionFindings(repo) {
  const reportPath = path.join(avDir(repo), 'session-report.json');
  if (!fs.existsSync(reportPath)) {
    return { error: 'NO_SESSION_FINDING', message: '没有会话报告。请先调用 av_session_report，或去掉 from=session 做实时全楼扫描。' };
  }
  let report;
  try {
    report = migrateReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  } catch (e) {
    return { error: 'NO_SESSION_FINDING', message: '会话报告无法解析：' + e.message };
  }
  // 过期存根：基线已刷新、旧报告被覆写为过期标记。拒绝把旧 findings 当成当前结果。
  if (isStaleReport(report)) {
    return { error: 'NO_SESSION_FINDING', message: '这份会话报告已过期（基线已刷新，旧红灯/绿灯失效）。请重新调用 av_session_report 生成最新结果。' };
  }
  const findings = report.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    return { error: 'NO_SESSION_FINDING', message: '会话报告里没有 finding。本轮是绿灯——未检测到架构风险（源代码内容可能已修改，但结构指纹无变化）。不要把全楼历史问题当成这次红灯。' };
  }
  const bp = baselinePath(repo);
  if (!fs.existsSync(bp)) {
    return { error: 'NO_SESSION_FINDING', message: '有会话报告但基线已丢失。请重新 av_session_start 后再 report。' };
  }
  return {
    findings,
    diff: report.diff,
    impact: report.impact,
    baseline: JSON.parse(fs.readFileSync(bp, 'utf8')),
    graph: buildGraph(repo)
  };
}

function toolExplainFinding(args) {
  const repo = resolveRepo(args);
  let graph, baseline, diff, impact, findings;

  if (args.from === 'session') {
    const loaded = loadSessionFindings(repo);
    if (loaded.error) return { error: loaded.error, message: loaded.message };
    ({ graph, baseline, diff, impact, findings } = loaded);
  } else {
    ({ graph, baseline, diff, impact, findings } = liveScanFindings(repo));
  }

  let target = pickFinding(findings, args);

  // 报告里若是格式化字符串，用同一份 diff/基线还原对象——禁止改走空基线全楼扫描
  if (!target && findings.length > 0 && typeof findings[0] === 'string') {
    let teamRules = null;
    try { teamRules = loadSessionRules(repo); } catch { /* ignore */ }
    const rawFindings = evaluateRisk(diff, graph, baseline, impact, { rules: teamRules });
    target = pickFinding(rawFindings, args);
  }

  if (!target) {
    return { error: 'NOT_FOUND', message: `没找到对应的红灯。当前共 ${findings.length} 条问题。` };
  }

  return buildExplainResult(target, diff, graph);
}

function buildExplainResult(target, diff, graph) {
  let edgeEvidence = null;
  const layerRules = new Set(['cross-layer-violation', 'layer-skip']);
  const isTeamForbid = target.source === 'architecture-rules.yaml' || target.title === '团队分层禁令';
  if (layerRules.has(target.rule) || isTeamForbid) {
    const edge = (diff.addedEdges || []).find(e => {
      const fromNode = graph.nodes.find(n => n.id === e.from);
      const toNode = graph.nodes.find(n => n.id === e.to);
      return fromNode && toNode &&
        target.detail && target.detail.includes(fromNode.name) && target.detail.includes(toNode.name);
    });
    if (edge) {
      const fromNode = graph.nodes.find(n => n.id === edge.from);
      const toNode = graph.nodes.find(n => n.id === edge.to);
      edgeEvidence = {
        edgeType: edge.type,
        from: { id: edge.from, name: fromNode?.name, layer: fromNode?.layer, file: fromNode?.path, layerSignal: fromNode?.layerSignal },
        to: { id: edge.to, name: toNode?.name, layer: toNode?.layer, file: toNode?.path, layerSignal: toNode?.layerSignal },
        file: edge.file,
        line: edge.line
      };
      // Fill missing layers on finding so direction-aware suggestion works
      if (!target.fromLayer && fromNode?.layer) target.fromLayer = fromNode.layer;
      if (!target.toLayer && toNode?.layer) target.toLayer = toNode.layer;
    }
  }

  return {
    finding: formatFinding(target),
    rule: target.rule,
    severity: target.severity,
    edgeEvidence,
    suggestion: suggestForFinding(target)
  };
}

/**
 * 导出 Archify IR 稀疏图（base/head + sidecar），写到 <repo>/.av/。
 * 默认 scope=changed；图太密或纯新增会自动降级为 layers。
 * validate=true 且本机有 archify CLI 时顺带校验；校验失败不报错，
 * 调用方应回退内置渲染器（session-report.html）。
 */
function toolArchifyExport(args) {
  const repo = resolveRepo(args);
  const res = exportArchify({
    repo,
    scope: args.scope || 'changed',
    validate: !!args.validate
  });
  if (res.error === 'NO_BASELINE') {
    return { error: 'NO_BASELINE', message: res.message };
  }
  const out = {
    scope: res.sidecar.scopeRequested,
    scopeUsed: res.sidecar.scopeUsed,
    downgradedToLayers: res.sidecar.downgradedToLayers,
    downgradeReason: res.sidecar.downgradeReason,
    componentCount: res.sidecar.componentCount,
    connectionCount: res.sidecar.connectionCount,
    files: res.files,
    hint: 'IR 文件可喂给 archify validate/render/compare；downgradedToLayers=true 时为层摘要图。'
  };
  if (res.validation) {
    out.validation = res.validation.available
      ? {
          ok: res.validation.ok,
          base: { ok: res.validation.base.ok, codes: res.validation.base.codes || [] },
          head: { ok: res.validation.head.ok, codes: res.validation.head.codes || [] },
          fallback: res.validation.ok ? null : 'Archify 校验未通过，请使用内置渲染器 session-report.html。'
        }
      : { available: false, message: res.validation.message };
  }
  return out;
}

const TOOLS = [
  {
    name: 'av_guard',
    description: '日常结构验收（跨 Cursor / Claude / DeepSeek Harness 等）：无基线时自动 ensure，有 git 对照 HEAD，返回 ≤3 行 verdict。宣称完成前优先调这个。HTML 详情可选。必须显式传当前工作区绝对路径 repo。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前工作区根目录的绝对路径。' },
        editDir: { type: 'string', description: '可选。正在改代码的目录；与 repo 冲突时中止。' },
        confirmRepo: { type: 'string', description: '可选。确认检查 repo（当 cwd 是另一个 Git 根时）。' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_session_start',
    description: '改代码之前拍一张"改之前"的照片（记录当前结构）。MCP 长期进程还会开启自动监听（默认约 8 秒防抖）；CLI 不会持续监听，改完需手动 report。日常优先 av_guard。必须显式传当前工作区绝对路径 repo；务必回显返回的 path.checking。完全离线。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前 IDE 工作区根目录的绝对路径。不要写死主仓路径——worktree 场景会拍错照片。' },
        intent: { type: 'string', description: '可选。本次改动意图，例如「只修分层，不改 /todos」。报告会对照对外表面，不对齐只黄灯/信息，不阻断。' },
        editDir: { type: 'string', description: '可选。正在改代码的目录绝对路径；与 repo 不是同一 Git 根时中止。' },
        confirmRepo: { type: 'string', description: '可选。当 MCP cwd 与 repo 不是同一 Git 根、但你确认就要检查 repo 时，传入与 repo 相同的绝对路径。' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_session_changes',
    description: '轻量检查"有没有架构变更"——不生成文件、秒回。若 status=analyzing，看 remainingSec；不想等请直接调 av_session_report 或 av_guard（会取消防抖立即重算）。必须显式传当前工作区绝对路径 repo。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前工作区根目录的绝对路径。' },
        editDir: { type: 'string', description: '可选。正在改代码的目录；与 repo 冲突时中止。' },
        confirmRepo: { type: 'string', description: '可选。确认检查 repo（当 cwd 是另一个 Git 根时）。' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_session_report',
    description: '看本轮结构验收结论（对话内 verdict：灯色 + 风险计数 + 最严重 1 条）与完整报告。有 git 时默认对照 HEAD，不必先 av_session_start。日常可用 av_guard（会自动 ensure）。有进行中的防抖时会取消并立即重算。HTML（.av/session-report.html）为可选深挖。必须显式传当前工作区绝对路径 repo。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前工作区根目录的绝对路径。' },
        from: { type: 'string', enum: ['session'], description: '可选：从会话报告取数据' },
        editDir: { type: 'string', description: '可选。正在改代码的目录；与 repo 冲突时中止。' },
        confirmRepo: { type: 'string', description: '可选。确认检查 repo（当 cwd 是另一个 Git 根时）。' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_status',
    description: '给使用者看的会话状态：基线在哪、watcher 是否在跑、监听哪个仓、报告是缓存还是过期、实时指纹有没有变。必须显式传当前工作区绝对路径 repo。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前工作区根目录的绝对路径。' },
        editDir: { type: 'string', description: '可选。正在改代码的目录；与 repo 冲突时中止。' },
        confirmRepo: { type: 'string', description: '可选。确认检查 repo（当 cwd 是另一个 Git 根时）。' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_check_layering',
    description: '查全楼所有历史问题（不需要先拍照片）。适合第一次摸底，会列出全部"串门"。日常验收用 av_guard / av_session_report 而不是这个。完全离线，1-2 秒完成。必须显式传当前工作区绝对路径 repo。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前工作区根目录的绝对路径。' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_explain_finding',
    description: '解释某条红灯的详情：谁串了谁的门、跳了哪一层、怎么修。按违规方向给出不同建议。from=session 时只读本轮报告，找不到就报错，不会静默改扫全楼。必须显式传当前工作区绝对路径 repo。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前工作区根目录的绝对路径。' },
        rule: { type: 'string', description: '规则名（cross-layer-violation, layer-skip, removed-type, new-external-dep, public-surface-changed, schema-touched, invariant-broken, intent-mismatch, behavior-untested）' },
        index: { type: 'integer', description: '问题列表中的序号（从0开始）' },
        from: { type: 'string', enum: ['session'], description: '从会话报告取本轮红灯；报告不存在或 findings 为空时返回 NO_SESSION_FINDING，绝不改扫全楼' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_archify_export',
    description: '把本次会话的架构 diff 导出为 Archify IR 稀疏图（Before/After 两个 JSON + sidecar），写到项目 .av/ 目录，可喂给 archify validate/render/compare 出图。默认 scope=changed（只含变更文件）；图太密或纯新增文件时自动降级为 layers 层摘要图。需要可解析基线（git HEAD 或快照）。validate=true 时若本机装了 archify 会顺带校验，校验失败不报错——回退内置报告图即可。必须显式传当前工作区绝对路径 repo。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '必填。当前工作区根目录的绝对路径。' },
        scope: { type: 'string', enum: ['changed', 'violations', 'layers'], description: '导出范围：changed=变更文件（默认），violations=只看违规边，layers=层摘要图' },
        validate: { type: 'boolean', description: '是否顺带运行 archify validate（需要本机有 archify CLI，默认 false）' }
      },
      required: ['repo']
    }
  }
];

function validateToolArgs(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const schema = tool.inputSchema || { type: 'object' };
  const input = args && typeof args === 'object' ? args : {};
  const errors = [];

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function check(value, sch, path) {
    if (!sch) return;
    if (sch.type === 'object') {
      if (typeOf(value) !== 'object') {
        errors.push(`${path}: expected object, got ${typeOf(value)}`);
        return;
      }
      const required = sch.required || [];
      for (const key of required) {
        if (value[key] === undefined || value[key] === null || value[key] === '') {
          errors.push(`${path}.${key}: required`);
        }
      }
      const props = sch.properties || {};
      for (const [key, propSch] of Object.entries(props)) {
        if (value[key] === undefined) continue;
        check(value[key], propSch, `${path}.${key}`);
      }
      // Fail closed on unknown keys at the top level of tool args
      if (path === 'args') {
        for (const key of Object.keys(value)) {
          if (!props[key]) errors.push(`${path}.${key}: unexpected property`);
        }
      }
      return;
    }
    if (sch.type === 'string') {
      if (typeof value !== 'string') errors.push(`${path}: expected string`);
      else if (sch.enum && !sch.enum.includes(value)) {
        errors.push(`${path}: must be one of ${sch.enum.join('|')}`);
      }
      return;
    }
    if (sch.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      return;
    }
    if (sch.type === 'integer') {
      if (!Number.isInteger(value)) errors.push(`${path}: expected integer`);
      return;
    }
    if (sch.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path}: expected number`);
    }
  }

  check(input, schema, 'args');
  if (errors.length) {
    const err = new Error(`INVALID_ARGS: ${errors.join('; ')}`);
    err.code = 'INVALID_ARGS';
    err.errors = errors;
    throw err;
  }
  return input;
}

function handleToolCall(params) {
  const { name, arguments: args } = params;
  const validated = validateToolArgs(name, args || {});
  switch (name) {
    case 'av_guard': return toolSessionGuard(validated);
    case 'av_session_start': return toolSessionStart(validated);
    case 'av_session_changes': return toolSessionChanges(validated);
    case 'av_session_report': return toolSessionReport(validated);
    case 'av_status': return toolSessionStatus(validated);
    case 'av_check_layering': return toolCheckLayering(validated);
    case 'av_explain_finding': return toolExplainFinding(validated);
    case 'av_archify_export': return toolArchifyExport(validated);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function createServer() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  function handleRequest(msg) {
    const { id, method, params } = msg;
    try {
      switch (method) {
        case 'initialize':
          send({
            jsonrpc: '2.0', id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'architecture-viewer', version: PKG_VERSION }
            }
          });
          break;
        case 'notifications/initialized':
          break;
        case 'tools/list':
          send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
          break;
        case 'tools/call': {
          const result = handleToolCall(params);
          send({
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
          });
          break;
        }
        default:
          send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  }

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; }
    handleRequest(msg);
  });

  return { rl };
}

module.exports = {
  TOOLS, handleToolCall, validateToolArgs,
  toolSessionGuard, toolSessionStart, toolSessionReport, toolSessionChanges, toolSessionStatus, toolCheckLayering, toolExplainFinding, toolArchifyExport,
  buildExplainResult, createServer, generateSessionReport, peekSessionDiff,
  startWatcher, stopWatcher, getWatcherState, flushWatcherDebounce, shouldWatchFile,
  resolveRepo, resolveDebounceMs, DEFAULT_DEBOUNCE_MS, PKG_VERSION
};

if (require.main === module) {
  createServer();
}
