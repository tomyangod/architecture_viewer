'use strict';

/**
 * Architecture Viewer — Session mode (AI 代码变更可见性)
 *
 * 工作流：
 *   1. sessionStart  记录当前架构基线到 .av/graph-baseline.json
 *   2. 文件监听（防抖）  AI/人改完代码、静默 N 秒后自动重提取
 *   3. 状态栏角标       显示 +新增 -删除 ~修改 / 风险数，点击打开报告
 *   4. sessionReport   生成 Before/After HTML 报告并在 Webview 面板打开
 *
 * 核心分析能力全部复用 lib/（阶段 A/B 已验证），本文件只做 VS Code API 适配。
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { buildGraph, attachCallEdges } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { summarizeFindings } = require('../lib/risk-rules');
const { runAnalyzers } = require('../lib/analyzers');
const { generateReport, buildSessionReportJson } = require('../lib/session-report');
const { computeImpact } = require('../lib/impact');
const { resolveSessionBaseline, hasResolvableBaseline } = require('../lib/session-baseline');
const { SKIP_DIRS, DEV_SKIP_DIRS, SKIP_FILE_RE } = require('../lib/extract/shared');
const { applyWebviewCsp } = require('./webview-csp');

const AV_DIR = '.av';
const BASELINE_FILE = 'graph-baseline.json';
const REPORT_HTML = 'session-report.html';
const REPORT_JSON = 'session-report.json';

// 监听的源码扩展名（与扫描器口径一致）
const WATCH_EXTS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx',
  '.py', '.go', '.java', '.vue', '.svelte'
]);

const CFG_SECTION = 'architectureViewer.session';

function rootPath() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder ? folder.uri.fsPath : null;
}

function avDir(root) {
  return path.join(root, AV_DIR);
}
function baselinePath(root) {
  return path.join(avDir(root), BASELINE_FILE);
}
function reportHtmlPath(root) {
  return path.join(avDir(root), REPORT_HTML);
}
function reportJsonPath(root) {
  return path.join(avDir(root), REPORT_JSON);
}

function cfg() {
  const c = vscode.workspace.getConfiguration(CFG_SECTION);
  return {
    enabled: c.get('enabled', true),
    debounceSeconds: Math.max(2, Number(c.get('debounceSeconds', 30)) || 30),
    analyzeOnOpen: c.get('analyzeOnOpen', true)
  };
}

/**
 * 判断一个文件路径是否属于应监听的源码文件。
 * 跳过规则与扫描器一致，但只作用于「工作区根之内」的路径段——
 * 工作区之外的父目录（如 ~/.trae-cn/...）不参与判断。
 */
function isRelevantSource(fsPath, root) {
  const ext = path.extname(fsPath).toLowerCase();
  if (!WATCH_EXTS.has(ext)) return false;
  if (SKIP_FILE_RE.test(path.basename(fsPath))) return false;

  let rel = fsPath;
  if (root) {
    if (fsPath === root) return true;
    if (fsPath.startsWith(root + path.sep)) {
      rel = fsPath.slice(root.length + 1);
    } else {
      return false; // 工作区之外
    }
  }
  const segments = rel.split(path.sep);
  for (const seg of segments) {
    if (!seg) continue;
    if (SKIP_DIRS.has(seg) || DEV_SKIP_DIRS.has(seg)) return false;
    if (seg.startsWith('.')) return false; // 嵌套隐藏目录（.git/.venv/.av 等）
  }
  return true;
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activateSession(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'architectureViewer.sessionReport';
  context.subscriptions.push(status);

  const state = {
    running: false,
    hasBaseline: false,
    result: null, // { diff, findings, riskSummary, impact, htmlPath }
    error: null,
    timer: null,
    watcher: null
  };

  // ---- commands ----
  context.subscriptions.push(
    vscode.commands.registerCommand('architectureViewer.sessionStart', () => sessionStart(state, status)),
    vscode.commands.registerCommand('architectureViewer.sessionReport', () => sessionReport(state, status, context)),
    vscode.commands.registerCommand('architectureViewer.sessionRefresh', () => runAnalysis(state, status, true))
  );

  // ---- file watcher ----
  setupWatcher(state, status, context);

  // ---- initial render + optional initial analysis ----
  const root = rootPath();
  state.hasBaseline = !!root && hasResolvableBaseline(root);
  renderStatus(state, status);

  if (cfg().analyzeOnOpen && root && state.hasBaseline) {
    // 延迟启动，避免拖慢窗口激活
    const t = setTimeout(() => runAnalysis(state, status, false), 2500);
    context.subscriptions.push({ dispose: () => clearTimeout(t) });
  }

  // 工作区切换 / 配置变化时重估
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const r = rootPath();
      state.hasBaseline = !!r && hasResolvableBaseline(r);
      state.result = null;
      renderStatus(state, status);
      setupWatcher(state, status, context);
      if (cfg().analyzeOnOpen && r && state.hasBaseline) scheduleAnalysis(state, status);
    })
  );

  return { state, status };
}

function setupWatcher(state, status, context) {
  if (state.watcher) {
    state.watcher.dispose();
    state.watcher = null;
  }
  if (!cfg().enabled) return;
  const root = rootPath();
  if (!root) return;

  const pattern = new vscode.RelativePattern(
    vscode.workspace.workspaceFolders[0],
    '**/*.{js,jsx,mjs,cjs,ts,tsx,py,go,java,vue,svelte}'
  );
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  state.watcher = watcher;
  context.subscriptions.push(watcher);

  const onChange = (uri) => {
    const r = rootPath();
    if (!r) return;
    if (!isRelevantSource(uri.fsPath, r)) return;
    if (!hasResolvableBaseline(r)) return; // 无基线不分析
    state.hasBaseline = true;
    scheduleAnalysis(state, status);
  };
  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);
}

function scheduleAnalysis(state, status) {
  if (state.timer) clearTimeout(state.timer);
  renderStatus(state, status, { pending: true });
  state.timer = setTimeout(() => {
    state.timer = null;
    runAnalysis(state, status, false);
  }, cfg().debounceSeconds * 1000);
}

/** 记录架构基线（session start）。 */
async function sessionStart(state, status) {
  const root = rootPath();
  if (!root) {
    vscode.window.showErrorMessage('Architecture Viewer: 请先打开一个工作区文件夹');
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Architecture Viewer: 记录架构基线…' },
    async () => {
      try {
        fs.mkdirSync(avDir(root), { recursive: true });
        // 让 UI 先刷新
        await tick();
        const graph = buildGraph(root);
        const snapshot = { ...graph, sessionStartedAt: new Date().toISOString() };
        fs.writeFileSync(baselinePath(root), JSON.stringify(snapshot, null, 2));
        state.hasBaseline = true;
        state.result = null;
        state.error = null;
        renderStatus(state, status);
        vscode.window.showInformationMessage(
          `架构基线已记录：${graph.stats.files} 文件 / ${graph.stats.types} 类型。AI 改完代码后，点击状态栏角标查看架构变更。`
        );
      } catch (e) {
        state.error = e;
        renderStatus(state, status);
        vscode.window.showErrorMessage('Architecture Viewer 基线记录失败：' + (e && e.message));
      }
    }
  );
}

/** 生成并打开架构变更报告（session report）。 */
async function sessionReport(state, status, context) {
  const root = rootPath();
  if (!root) {
    vscode.window.showErrorMessage('Architecture Viewer: 请先打开一个工作区文件夹');
    return;
  }
  if (!hasResolvableBaseline(root)) {
    const pick = await vscode.window.showInformationMessage(
      'Architecture Viewer: 尚未记录架构基线（无 git HEAD / 快照）。现在记录快照，开始监听？',
      { modal: false },
      '记录基线'
    );
    if (pick === '记录基线') {
      await sessionStart(state, status);
    }
    return;
  }

  if (state.running) {
    vscode.window.showInformationMessage('Architecture Viewer 正在分析，请完成后再打开报告。');
    return;
  }
  // External contracts can change without a watched source edit.
  await runAnalysis(state, status, true);
  if (state.error) {
    vscode.window.showErrorMessage('Architecture Viewer 报告生成失败：' + state.error.message);
    return;
  }
  if (!state.result) return;

  openReportWebview(context, state.result, root);
}

/** 跑一次 head 提取 + diff + impact + risk，落盘 HTML/JSON，更新角标。 */
async function runAnalysis(state, status, notify) {
  const root = rootPath();
  if (!root) return;
  const resolved = resolveSessionBaseline(root);
  if (!resolved.ok) {
    state.hasBaseline = false;
    renderStatus(state, status);
    return;
  }
  if (state.running) return;
  state.running = true;
  state.error = null;
  renderStatus(state, status);

  try {
    await tick(); // 让出事件循环，刷新「分析中」角标
    const baseline = resolved.graph;
    const sessionStartTs = baseline.sessionStartedAt || baseline.cachedAt || null;
    const current = buildGraph(root, { calls: true });
    attachCallEdges(current, { incremental: true, base: baseline });
    const diff = diffGraphs(baseline, current);
    const impact = computeImpact(diff, baseline, current);
    const { merged, sources: analyzerStatus } = runAnalyzers(root, { current, baseline, diff, impact });
    const findings = merged.violations;
    const riskSummary = summarizeFindings(findings);

    fs.mkdirSync(avDir(root), { recursive: true });
    const { buildAwareness, markAwarenessSeen } = require('../lib/awareness');
    const awareness = buildAwareness({ findings, diff, repo: root, headGraph: current });
    const html = generateReport({
      baseGraph: baseline,
      headGraph: current,
      diff,
      findings,
      analyzerStatus,
      impact,
      repoName: path.basename(root),
      sessionStart: sessionStartTs,
      awareness
    });
    fs.writeFileSync(reportHtmlPath(root), html);
    fs.writeFileSync(
      reportJsonPath(root),
      JSON.stringify(buildSessionReportJson({
        diff, findings, riskSummary, impact, analyzerStatus,
        baseGraph: baseline, headGraph: current,
        repoName: path.basename(root),
        awareness
      }), null, 2)
    );
    try {
      markAwarenessSeen(root, { awareness, headFingerprint: current.fingerprint });
    } catch { /* best-effort */ }

    state.result = { diff, findings, riskSummary, impact, analyzerStatus, htmlPath: reportHtmlPath(root) };
    state.hasBaseline = true;

    const s = diff.summary;
    const changed = (s.addedTypes || 0) + (s.removedTypes || 0) + (s.modifiedNodes || 0) > 0
      || (s.addedEdges || 0) + (s.removedEdges || 0) > 0;

    if (notify) {
      if (changed || findings.length) {
        const high = findings.filter((f) => f.severity === 'high').length;
        vscode.window.showInformationMessage(
          `架构变更：+${s.addedTypes} -${s.removedTypes} ~${s.modifiedNodes} 类型，` +
          `${findings.length} 条风险发现${high ? `（${high} 高风险）` : ''}。报告已在侧边面板打开。`
        );
      } else {
        vscode.window.showInformationMessage('架构无变更（与基线一致）。');
      }
    }
  } catch (e) {
    state.error = e;
    if (notify) {
      vscode.window.showErrorMessage('Architecture Viewer 分析失败：' + (e && e.message));
    }
  } finally {
    state.running = false;
    renderStatus(state, status);
  }
}

function openReportWebview(context, result, root) {
  const panel = vscode.window.createWebviewPanel(
    'architectureViewer.sessionReport',
    '架构变更报告 · ' + path.basename(root),
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(avDir(root))]
    }
  );

  const html = applyWebviewCsp(fs.readFileSync(result.htmlPath, 'utf8'), panel.webview.cspSource);
  panel.webview.html = html;
}

function renderStatus(state, status, opts) {
  const root = rootPath();
  if (!root) {
    status.hide();
    return;
  }

  if (state.running) {
    status.text = '$(sync~spin) AV 分析中…';
    status.tooltip = 'Architecture Viewer 正在分析架构变更…';
    status.backgroundColor = undefined;
    status.show();
    return;
  }

  if (!state.hasBaseline) {
    status.text = '$(circle-slash) AV 无基线';
    status.tooltip = 'Architecture Viewer：点击记录架构基线，开始监听 AI 代码变更';
    status.backgroundColor = undefined;
    status.show();
    return;
  }

  if (state.error) {
    status.text = '$(error) AV 分析失败';
    status.tooltip = 'Architecture Viewer 分析失败：' + state.error.message + '\n点击重试';
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    status.show();
    return;
  }

  if (!state.result) {
    status.text = opts && opts.pending ? '$(eye) AV 等待变更…' : '$(eye) AV 监听中';
    status.tooltip = 'Architecture Viewer：正在监听代码变更（AI 改完后自动分析）';
    status.backgroundColor = undefined;
    status.show();
    return;
  }

  const s = state.result.diff.summary;
  const findings = state.result.findings;
  const high = findings.filter((f) => f.severity === 'high').length;
  const med = findings.filter((f) => f.severity === 'medium').length;
  const changed =
    (s.addedTypes || 0) + (s.removedTypes || 0) + (s.modifiedNodes || 0) +
    (s.addedEdges || 0) + (s.removedEdges || 0) > 0;

  if (!changed && findings.length === 0) {
    status.text = '$(check) AV 无变更';
    status.tooltip = 'Architecture Viewer：代码结构与基线一致';
    status.backgroundColor = undefined;
    status.show();
    return;
  }

  const parts = [];
  if (s.addedTypes) parts.push(`+${s.addedTypes}`);
  if (s.removedTypes) parts.push(`-${s.removedTypes}`);
  if (s.modifiedNodes) parts.push(`~${s.modifiedNodes}`);
  const warnCount = high + med;
  const warn = warnCount ? ` ⚠${warnCount}` : '';

  if (high) {
    status.text = `$(error) AV ${parts.join(' ')}${warn}`;
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (med) {
    status.text = `$(warning) AV ${parts.join(' ')}${warn}`;
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    status.text = `$(check) AV ${parts.join(' ')}${warn}`;
    status.backgroundColor = undefined;
  }

  status.tooltip =
    `Architecture Viewer 架构变更\n` +
    `新增类型 ${s.addedTypes || 0} / 删除 ${s.removedTypes || 0} / 修改 ${s.modifiedNodes || 0}\n` +
    `新增关系 ${s.addedEdges || 0} / 删除 ${s.removedEdges || 0}\n` +
    `分层违规 ${s.violations || 0} / 风险发现 ${findings.length}（高 ${high} 中 ${med}）\n` +
    `点击打开 Before/After 架构变更报告`;
  status.show();
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deactivate() {}

module.exports = { activateSession, deactivate, isRelevantSource, WATCH_EXTS };
