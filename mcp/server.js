'use strict';

/**
 * Architecture Viewer MCP Server
 *
 * 暴露 5 个工具给 AI Agent（Cursor/Claude/Codex）：
 *   av_session_start    — AI 改代码前记录基线
 *   av_session_report   — AI 改完后返回架构 diff + 风险 + 影响面
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
const { evaluateRisk, summarizeFindings, LAYER_LABEL } = require('../lib/risk-rules');
const { computeImpact } = require('../lib/impact');
const { generateReport } = require('../lib/session-report');
const { exportArchify, finalizeSessionHtml } = require('../lib/archify-export');

function avDir(repo) {
  return path.join(repo, '.av');
}

function baselinePath(repo) {
  return path.join(avDir(repo), 'graph-baseline.json');
}

// ─── 自动闭环：文件监听 + 防抖自动报告 ───────────────────────────
// AI 改代码时文件不断保存，watcher 静默 DEBOUNCE_MS 毫秒后自动跑 diff，
// 生成报告缓存。AI 调 av_session_report 时直接命中缓存（秒回），
// 调 av_session_changes 做轻量轮询（不生成文件）。

const DEBOUNCE_MS = 20000; // AI 停下 20 秒后自动出报告
const WATCH_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.vue', '.svelte', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', '.av', 'dist', 'build', '.next', 'coverage', '__pycache__', '.idea', '.vscode', '.trae']);

/** repoPath -> { watcher, timer, autoReport, watching, pendingFiles } */
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
  const bp = baselinePath(repo);
  if (!fs.existsSync(bp)) return null;

  const baseline = JSON.parse(fs.readFileSync(bp, 'utf8'));
  const sessionStart = baseline.sessionStartedAt;
  const current = buildGraph(repo);
  const diff = diffGraphs(baseline, current);
  const impact = computeImpact(diff, baseline, current);
  const findings = evaluateRisk(diff, current, baseline, impact);
  const riskSummary = summarizeFindings(findings);

  const dir = avDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const reportJsonPath = path.join(dir, 'session-report.json');
  fs.writeFileSync(reportJsonPath, JSON.stringify({ diff, findings, riskSummary, impact }, null, 2));
  const html = generateReport({
    baseGraph: baseline, headGraph: current, diff, findings, impact,
    repoName: path.basename(repo), sessionStart
  });
  const finalized = finalizeSessionHtml({ repo, builtinHtml: html });

  return {
    generatedAt: Date.now(),
    summary: {
      ...diff.summary,
      baseFingerprint: diff.base.fingerprint,
      headFingerprint: diff.head.fingerprint,
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
    message: riskSummary.level === 'high'
      ? `🔴 红灯 — ${findings.length} 个问题需要你亲眼看一下，可能改坏了结构，建议先看再提交。`
      : riskSummary.level === 'medium'
        ? `🟠 黄灯 — ${findings.length} 个值得注意的地方，建议看一下。`
        : riskSummary.level === 'low'
          ? `🔵 蓝灯 — ${findings.length} 个小提示，有空可以看看。`
          : `✅ 绿灯 — 没发现问题，结构改动正常。`
  };
}

/** 启动文件监听：AI 改代码后自动生成报告 */
function startWatcher(repo) {
  // 已在监听则先停掉旧的（重新 start 时重置）
  stopWatcher(repo);

  const state = { watcher: null, timer: null, autoReport: null, watching: true, pendingFiles: 0 };

  try {
    const watcher = fs.watch(repo, { recursive: true }, (_event, filename) => {
      if (!filename || !shouldWatchFile(filename)) return;
      state.pendingFiles++;
      // 重置防抖计时器
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = null;
        state.pendingFiles = 0;
        try {
          const report = generateSessionReport(repo);
          if (report) state.autoReport = report;
        } catch (e) {
          // 自动报告失败不崩溃，手动 report 时会再试
          state.autoReport = { error: e.message, generatedAt: Date.now() };
        }
      }, DEBOUNCE_MS);
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
  return `${icon} [${f.severity.toUpperCase()}] ${f.title}: ${f.message}\n   ${f.detail || ''}`;
}

function formatImpact(impact) {
  if (!impact || !impact.items || impact.items.length === 0) return '没有波及范围数据';
  const lines = [`改了 ${impact.summary.changed} 个地方，会波及 ${impact.summary.affected} 个其他地方`];
  for (const it of impact.items.slice(0, 5)) {
    const direct = (it.direct || []).length;
    const transitive = (it.transitive || []).length;
    lines.push(`  • [${it.change}] ${it.id} → 直接受影响 ${direct}，间接受影响 ${transitive}`);
  }
  return lines.join('\n');
}

function toolSessionStart(args) {
  const repo = path.resolve(args.repo);
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
  fs.mkdirSync(avDir(repo), { recursive: true });
  const graph = buildGraph(repo);
  const snapshot = { ...graph, sessionStartedAt: new Date().toISOString() };
  fs.writeFileSync(baselinePath(repo), JSON.stringify(snapshot, null, 2));
  const suggested = writeLayerSuggestions(repo, graph);

  // 启动文件监听：AI 改代码后自动生成报告，无需手动触发
  const watchState = startWatcher(repo);

  return {
    baseline: {
      files: graph.stats.files,
      types: graph.stats.types,
      edges: graph.stats.edges,
      externalPackages: graph.stats.externalPackages,
      fingerprint: graph.fingerprint,
      savedTo: baselinePath(repo)
    },
    autoWatch: watchState.watching
      ? '已开启自动监听：你改代码时系统会自动检测，停下 20 秒后自动生成架构报告。改完后调 av_session_changes 轻量检查，或直接调 av_session_report 看详情（缓存命中秒回）。'
      : `自动监听不可用（${watchState.watchError || '当前环境不支持'}），改完代码后请手动调 av_session_report。`,
    layerSuggestions: suggested
      ? { path: suggested, note: '工具自动帮你分好了楼层。觉得没问题就不用管；想锁定就复制为 .av/layers.json' }
      : null,
    message: `已经拍好了"改之前"的照片（${graph.stats.files} 个文件、${graph.stats.types} 个组件）。现在可以放心改代码，系统会自动盯着结构变化。`
  };
}

function toolSessionReport(args) {
  const repo = path.resolve(args.repo);
  const bp = baselinePath(repo);
  if (!fs.existsSync(bp)) {
    return { error: 'NO_BASELINE', message: '还没拍"改之前"的照片。请先调用 av_session_start 再改代码。' };
  }

  // 优先用 watcher 自动生成的新鲜缓存（10 分钟内），避免重复计算
  const state = getWatcherState(repo);
  if (state && state.autoReport && !state.autoReport.error) {
    const ageMs = Date.now() - state.autoReport.generatedAt;
    if (ageMs < 10 * 60 * 1000) {
      return { ...state.autoReport, cached: true, cacheAgeSec: Math.round(ageMs / 1000) };
    }
  }

  // 缓存不存在或过期：实时生成
  const report = generateSessionReport(repo);
  if (!report) {
    return { error: 'NO_BASELINE', message: '还没拍"改之前"的照片。请先调用 av_session_start 再改代码。' };
  }
  // 更新缓存
  if (state) state.autoReport = report;
  return report;
}

/**
 * 轻量检查：不生成 HTML 文件，只返回"有没有架构变更、风险等级"。
 * AI 在每次完成代码修改、回复用户前调用，成本极低。
 * 如果 watcher 正在防抖（检测到变更但还没跑完），返回 analyzing 状态。
 */
function toolSessionChanges(args) {
  const repo = path.resolve(args.repo);
  const bp = baselinePath(repo);
  if (!fs.existsSync(bp)) {
    return { error: 'NO_BASELINE', message: '还没拍"改之前"的照片。请先调 av_session_start。' };
  }

  const state = getWatcherState(repo);

  // watcher 正在防抖（检测到文件变更，等待 AI 停下）
  if (state && state.timer) {
    return {
      watching: true,
      status: 'analyzing',
      hasChanges: true,
      message: '检测到代码变更，正在等你停下（20 秒无新改动后自动出报告）。稍等片刻再调 av_session_report 看详情。'
    };
  }

  // 有自动生成的报告
  if (state && state.autoReport && !state.autoReport.error) {
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
        : '没有检测到架构变更，结构没变。'
    };
  }

  // watcher 在监听但还没检测到变更
  if (state && state.watching) {
    return {
      watching: true,
      status: 'idle',
      hasChanges: false,
      message: '正在监听中，还没检测到代码变更。改完代码后停下 20 秒，系统会自动出报告。'
    };
  }

  // 没有 watcher（可能 server 重启过）：实时快速检查
  const report = generateSessionReport(repo);
  if (!report) {
    return { watching: false, status: 'no-baseline', hasChanges: false, message: '请先调 av_session_start。' };
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
      : '没有检测到架构变更，结构没变。'
  };
}

function toolCheckLayering(args) {
  const repo = path.resolve(args.repo);
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
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

function toolExplainFinding(args) {
  const repo = path.resolve(args.repo);
  const bp = baselinePath(repo);
  const hasBaseline = fs.existsSync(bp);

  let graph, baseline, diff, impact, findings;

  // 尝试从会话报告取数据
  if (hasBaseline && args.from === 'session') {
    const reportPath = path.join(avDir(repo), 'session-report.json');
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (report.findings && report.findings.length > 0) {
        diff = report.diff;
        impact = report.impact;
        baseline = JSON.parse(fs.readFileSync(bp, 'utf8'));
        graph = buildGraph(repo);
        findings = report.findings;
      }
    }
  }

  // fallback：实时检测——用空基线，让所有边都算"新增"，从而检测出当前图内部的跨层违规
  if (!findings) {
    graph = buildGraph(repo);
    const emptyBase = { nodes: [], edges: [], fingerprint: '', root: graph.root, stats: {} };
    diff = diffGraphs(emptyBase, graph);
    impact = computeImpact(diff, emptyBase, graph);
    findings = evaluateRisk(diff, graph, emptyBase, impact);
  }

  // 从 findings 里找匹配项；findings 可能是原始对象或已格式化的字符串
  let target = findings.find((f, i) => {
    if (typeof f === 'string') return false;
    return (args.rule && f.rule === args.rule) ||
           (args.index !== undefined && i === args.index);
  });

  // 如果 findings 是字符串数组，重新生成原始对象
  if (!target && findings.length > 0 && typeof findings[0] === 'string') {
    const rawFindings = evaluateRisk(diff, graph, baseline, impact);
    target = rawFindings.find((f, i) =>
      (args.rule && f.rule === args.rule) ||
      (args.index !== undefined && i === args.index)
    );
  }

  if (!target) {
    return { error: 'NOT_FOUND', message: `没找到对应的红灯。当前共 ${findings.length} 条问题。` };
  }

  return buildExplainResult(target, diff, graph);
}

function buildExplainResult(target, diff, graph) {
  let edgeEvidence = null;
  if (target.rule === 'cross-layer-violation' || target.rule === 'layer-skip') {
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
    }
  }

  return {
    finding: formatFinding(target),
    rule: target.rule,
    severity: target.severity,
    edgeEvidence,
    suggestion: target.rule === 'cross-layer-violation' || target.rule === 'layer-skip'
      ? '不要让前台直接跑去仓库拿东西——中间加一层"中间人"来中转，或者改成走接口。'
      : target.rule === 'removed-type'
        ? '检查有没有其他代码用到被删掉的东西，必要的话保留或给个替代方案。'
        : target.rule === 'new-external-dep'
          ? '确认这个新引入的外购零件是不是真的需要，检查许可证和安全。'
          : '请根据具体问题内容判断。'
  };
}

/**
 * 导出 Archify IR 稀疏图（base/head + sidecar），写到 <repo>/.av/。
 * 默认 scope=changed；图太密或纯新增会自动降级为 layers。
 * validate=true 且本机有 archify CLI 时顺带校验；校验失败不报错，
 * 调用方应回退内置渲染器（session-report.html）。
 */
function toolArchifyExport(args) {
  const repo = path.resolve(args.repo || process.cwd());
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
    name: 'av_session_start',
    description: '改代码之前拍一张"改之前"的照片（记录当前结构），并开启自动监听。在 Agent 开始改代码之前调用。调用后系统会自动盯着文件变化，AI 停下 20 秒后自动生成架构报告，不需要手动触发。完全离线。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目文件夹的绝对路径' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_session_changes',
    description: '轻量检查"有没有架构变更"——不生成文件、秒回。每次你完成一批代码修改、准备回复用户之前调用。如果返回有变更，再调 av_session_report 看完整报告和架构图；如果返回 analyzing 说明还在等防抖，稍等再调。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目文件夹的绝对路径' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_session_report',
    description: '看完整架构变更报告（含 Before/After 对比图、风险红灯、影响面）。改完代码后调用。如果自动监听已生成报告会秒回缓存；否则实时生成。红灯建议先看再提交。需要先调 av_session_start。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目文件夹的绝对路径' },
        from: { type: 'string', enum: ['session'], description: '可选：从会话报告取数据' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_check_layering',
    description: '查全楼所有历史问题（不需要先拍照片）。适合第一次摸底，会列出全部"串门"。日常验收用 av_session_report 而不是这个。完全离线，1-2 秒完成。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目文件夹的绝对路径' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_explain_finding',
    description: '解释某条红灯的详情：谁串了谁的门、跳了哪一层、怎么修。按序号定位。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目文件夹的绝对路径' },
        rule: { type: 'string', description: '规则名（cross-layer-violation, layer-skip, removed-type, new-external-dep）' },
        index: { type: 'integer', description: '问题列表中的序号（从0开始）' },
        from: { type: 'string', enum: ['session'], description: '可选：从会话报告取数据而非实时检测' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_archify_export',
    description: '把本次会话的架构 diff 导出为 Archify IR 稀疏图（Before/After 两个 JSON + sidecar），写到项目 .av/ 目录，可喂给 archify validate/render/compare 出图。默认 scope=changed（只含变更文件）；图太密或纯新增文件时自动降级为 layers 层摘要图。需要先调 av_session_start 建立基线。validate=true 时若本机装了 archify 会顺带校验，校验失败不报错——回退内置报告图即可。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目文件夹的绝对路径' },
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
    case 'av_session_start': return toolSessionStart(validated);
    case 'av_session_changes': return toolSessionChanges(validated);
    case 'av_session_report': return toolSessionReport(validated);
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
              serverInfo: { name: 'architecture-viewer', version: '0.10.0' }
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

module.exports = { TOOLS, handleToolCall, validateToolArgs, toolSessionStart, toolSessionReport, toolSessionChanges, toolCheckLayering, toolExplainFinding, toolArchifyExport, buildExplainResult, createServer, generateSessionReport, startWatcher, stopWatcher, getWatcherState, shouldWatchFile };

if (require.main === module) {
  createServer();
}
