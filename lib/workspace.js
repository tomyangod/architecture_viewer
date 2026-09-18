'use strict';

// 多仓基线管理（C3）：用户级仓库注册表 + 逐仓架构验收。
// 注册表默认在 ~/.arch-viewer/workspace.json，可用 --config 指定共享文件。
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph, toPersistableGraph, attachCallEdges } = require('./extract-graph');
const { diffGraphs } = require('./diff-graph');
const { summarizeFindings } = require('./risk-rules');
const { runAnalyzers } = require('./analyzers');
const { computeImpact } = require('./impact');
const { generateReport, buildSessionReportJson } = require('./session-report');
const { resolveSessionBaseline } = require('./session-baseline');

function defaultRegistryPath() {
  return path.join(os.homedir(), '.arch-viewer', 'workspace.json');
}

function loadRegistry(configPath) {
  const p = configPath ? path.resolve(configPath) : defaultRegistryPath();
  if (!fs.existsSync(p)) return { path: p, repos: [] };
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { path: p, repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
}

function saveRegistry(reg) {
  fs.mkdirSync(path.dirname(reg.path), { recursive: true });
  fs.writeFileSync(reg.path, JSON.stringify({ repos: reg.repos }, null, 2));
}

// 注册仓库；返回 { entry, added:boolean, reason?:string }
function addRepo(reg, repoPath, name) {
  const abs = path.resolve(repoPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { added: false, reason: `目录不存在: ${abs}` };
  }
  const id = name || path.basename(abs);
  const existingPath = reg.repos.find((r) => r.path === abs);
  if (existingPath) {
    return { added: false, reason: `已注册为 "${existingPath.name}"，跳过`, entry: existingPath };
  }
  if (reg.repos.some((r) => r.name === id)) {
    return { added: false, reason: `名字 "${id}" 已被占用，用 --name 指定其它名字` };
  }
  const entry = { name: id, path: abs };
  reg.repos.push(entry);
  return { added: true, entry };
}

function removeRepo(reg, nameOrPath) {
  const idx = reg.repos.findIndex(
    (r) => r.name === nameOrPath || r.path === path.resolve(nameOrPath)
  );
  if (idx === -1) return false;
  reg.repos.splice(idx, 1);
  return true;
}

// 在指定仓初始化基线（等价 session start），供 workspace add 时自动建档
function initBaseline(repoPath) {
  const avDir = path.join(repoPath, '.av');
  fs.mkdirSync(avDir, { recursive: true });
  const graph = buildGraph(repoPath);
  const { buildTestIndex } = require('./extract/test-index');
  const snapshot = {
    ...toPersistableGraph(graph),
    sessionStartedAt: new Date().toISOString(),
    testIndex: buildTestIndex(repoPath)
  };
  fs.writeFileSync(path.join(avDir, 'graph-baseline.json'), JSON.stringify(snapshot, null, 2));
  try { require('./session-intent').writeSessionIntent(repoPath, null, { sessionStartedAt: snapshot.sessionStartedAt }); } catch { /* ignore */ }
  return graph;
}

function changeCounts(diff) {
  const added = (diff.addedNodes || []).length;
  const removed = (diff.removedNodes || []).length;
  const modified = (diff.modifiedNodes || []).length + ((diff.renamedNodes && diff.renamedNodes.length) || 0);
  const extAdded = (diff.addedExternalDeps || []).length;
  const extRemoved = (diff.removedExternalDeps || []).length;
  return { added, removed, modified, extAdded, extRemoved, total: added + removed + modified + extAdded + extRemoved };
}

// 逐仓跑 session report 管线；HTML/JSON 写入各仓 .av/
function reportRepo(entry) {
  const avDir = path.join(entry.path, '.av');
  const resolved = resolveSessionBaseline(entry.path);
  if (!resolved.ok) {
    return { ...entry, status: resolved.error === 'SCAN_FAILED' ? 'scan-failed' : 'no-baseline' };
  }
  try {
    const baseline = resolved.graph;
    const current = buildGraph(entry.path, { calls: true });
    attachCallEdges(current, { incremental: true, base: baseline });
    const diff = diffGraphs(baseline, current);
    const impact = computeImpact(diff, baseline, current);
    const { buildTestIndex } = require('./extract/test-index');
    const testIndexHead = buildTestIndex(entry.path);
    const { merged, sources: analyzerStatus } = runAnalyzers(entry.path, {
      current, baseline, diff, impact,
      testIndexBase: baseline.testIndex || null,
      testIndexHead
    });
    const findings = merged.violations;
    const riskSummary = summarizeFindings(findings);
    const counts = changeCounts(diff);

    fs.mkdirSync(avDir, { recursive: true });
    const { buildAwareness, markAwarenessSeen } = require('./awareness');
    const awareness = buildAwareness({ findings, diff, repo: entry.path, headGraph: current });
    fs.writeFileSync(
      path.join(avDir, 'session-report.json'),
      JSON.stringify(buildSessionReportJson({
        diff, findings, riskSummary, impact, analyzerStatus,
        baseGraph: baseline, headGraph: current, repoName: entry.name, awareness
      }), null, 2)
    );
    const html = generateReport({
      baseGraph: baseline,
      headGraph: current,
      diff,
      findings,
      analyzerStatus,
      impact,
      repoName: entry.name,
      sessionStart: baseline.sessionStartedAt || baseline.cachedAt || null,
      awareness
    });
    fs.writeFileSync(path.join(avDir, 'session-report.html'), html);
    // workspace report CLI output doesn't present awareness cards - don't mark as seen

    return {
      ...entry,
      status: 'ok',
      diff,
      findings,
      riskSummary,
      analyzerStatus,
      impact,
      counts,
      hasChanges: counts.total > 0 || findings.length > 0,
      stats: current.stats,
      htmlPath: path.join(avDir, 'session-report.html')
    };
  } catch (e) {
    return { ...entry, status: 'error', error: e.message };
  }
}

function reportAll(reg) {
  return reg.repos.map(reportRepo);
}

module.exports = {
  defaultRegistryPath,
  loadRegistry,
  saveRegistry,
  addRepo,
  removeRepo,
  initBaseline,
  changeCounts,
  reportRepo,
  reportAll
};
