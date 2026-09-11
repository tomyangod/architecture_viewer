'use strict';

const path = require('path');
const { buildGraph, toPersistableGraph } = require('../../../lib/extract-graph');
const { diffGraphs } = require('../../../lib/diff-graph');
const { evaluateRisk, summarizeFindings, loadSessionRules } = require('../../../lib/risk-rules');
const { computeImpact } = require('../../../lib/impact');
const { shouldGate } = require('../../../lib/exit-codes');
const { resolveSessionBaseline, scanGitTreeish } = require('../../../lib/session-baseline');
const { formatComment } = require('./comment');

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function persist(graph) {
  return graph && graph.fingerprint ? graph : toPersistableGraph(graph);
}

function scanDirectory(root) {
  return persist(buildGraph(root));
}

function validateGraph(graph, side) {
  const stats = graph && graph.stats || {};
  if (stats.layerConfigError) {
    return { error: 'RULES_CONFIG_ERROR', message: `${side} 分层配置读取/解析失败：${stats.layerConfigError}` };
  }
  if (stats.parseErrors > 0) {
    return { error: 'SCAN_FAILED', message: `${side} 扫描有 ${stats.parseErrors} 个文件读取/解析失败，无法对不完整的图出验收结论。` };
  }
  return null;
}

function resolveBaseGraph(repoRoot, meta) {
  const m = meta || {};
  if (m.baseDir) {
    try {
      return { graph: scanDirectory(path.resolve(m.baseDir)), kind: 'base-dir' };
    } catch (e) {
      return { error: 'SCAN_FAILED', message: e.message };
    }
  }
  const sha = m.baseSha && SHA_RE.test(String(m.baseSha).trim()) ? String(m.baseSha).trim() : null;
  if (sha) {
    const scanned = scanGitTreeish(repoRoot, sha, { overlay: false });
    if (scanned.graph) return { graph: persist(scanned.graph), kind: 'pr-base', gitRef: sha };
    // PR jobs must not silently self-compare HEAD against HEAD.
    if (m.pr) {
      return {
        error: scanned.error || 'NO_BASELINE',
        message: scanned.message || `无法导出 PR base ${sha.slice(0, 12)}`
      };
    }
  }
  if (!m.pr) {
    const resolved = resolveSessionBaseline(repoRoot);
    if (resolved.ok) {
      return { graph: persist(resolved.graph), kind: resolved.kind, gitRef: resolved.gitHead };
    }
    return { error: resolved.error || 'NO_BASELINE', message: resolved.message };
  }
  return {
    error: 'NO_BASELINE',
    message: 'PR 托管检查需要对 base SHA 做增量对照；当前克隆无法导出 base 树。'
  };
}

function runHostedCheck(repoRoot, meta) {
  const root = path.resolve(repoRoot);
  const m = meta || {};
  const base = {
    repo: m.repoLabel,
    pr: m.pr,
    sha: m.sha,
    baseSha: m.baseSha,
    protocol: 'incremental'
  };

  let headGraph;
  try {
    headGraph = scanDirectory(root);
    const failure = validateGraph(headGraph, 'head');
    if (failure) {
      const result = Object.assign({ ok: false, reason: failure.error, message: failure.message }, base);
      result.markdown = formatComment(result);
      return result;
    }
  } catch (e) {
    const result = Object.assign({ ok: false, reason: 'SCAN_FAILED', message: e.message }, base);
    result.markdown = formatComment(result);
    return result;
  }

  let resolved;
  try {
    resolved = resolveBaseGraph(root, m);
  } catch (e) {
    resolved = { error: 'SCAN_FAILED', message: `base 扫描失败：${e.message}` };
  }
  if (resolved.graph) {
    const failure = validateGraph(resolved.graph, 'base');
    if (failure) resolved = failure;
  }
  if (!resolved.graph) {
    const result = Object.assign({
      ok: false,
      reason: resolved.error || 'NO_BASELINE',
      message: resolved.message
    }, base);
    result.markdown = formatComment(result);
    return result;
  }

  const diff = diffGraphs(resolved.graph, headGraph);
  const impact = computeImpact(diff, resolved.graph, headGraph);

  // Semantics: no rules file → null → default rules (allowed).
  // A rules file that exists but fails to read/parse must NOT silently
  // degrade to defaults: the hosted verdict would claim a gate the
  // customer's own constraints were never applied to.
  let teamRules = null;
  try {
    teamRules = loadSessionRules(root);
  } catch (e) {
    const result = Object.assign({
      ok: false,
      reason: 'RULES_CONFIG_ERROR',
      message: '团队规则文件存在但读取/解析失败，已中止检查（未按默认规则出验收结论）：' + e.message
    }, base);
    result.markdown = formatComment(result);
    return result;
  }
  const findings = evaluateRisk(diff, headGraph, resolved.graph, impact, { rules: teamRules });
  const riskSummary = summarizeFindings(findings);
  const gated = shouldGate(riskSummary.gateLevel || riskSummary.level, 'high');

  const result = Object.assign({
    ok: !gated,
    reason: gated ? 'GATE_FAILED' : null,
    baseKind: resolved.kind,
    diff,
    impact,
    findings,
    riskSummary,
    highCount: (riskSummary.counts && riskSummary.counts.high) || 0,
    findingCount: findings.length
  }, base);
  result.markdown = formatComment(result);
  return result;
}

module.exports = { runHostedCheck };
