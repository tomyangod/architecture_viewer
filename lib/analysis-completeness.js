'use strict';

const { summarizeFindings } = require('./risk-rules');

/**
 * 分析完整性：区分「查过且没问题」与「没查出来 / 结果不完整」。
 * 假绿灯（parseErrors>0 仍显示「没有串门」）是交付阻塞。
 */

/**
 * @param {object} graph - buildGraph() 结果
 * @returns {{
 *   status: 'ok'|'incomplete'|'failed',
 *   allowGreen: boolean,
 *   reasons: string[],
 *   stats: object,
 *   finding: object|null,
 *   message: string|null
 * }}
 */
function assessAnalysisCompleteness(graph) {
  const stats = (graph && graph.stats) || {};
  const files = Number(stats.files) || 0;
  const filesParsed = Number(stats.filesParsed) || 0;
  const parseErrors = Number(stats.parseErrors) || 0;
  const truncated = !!(stats.scanTruncated || stats.truncated);
  const skippedDirs = Array.isArray(stats.skippedDevDirs) ? stats.skippedDevDirs : [];
  const unreadableDirs = Array.isArray(stats.unreadableDirs) ? stats.unreadableDirs : [];
  const unreadableFiles = Array.isArray(stats.unreadableFiles) ? stats.unreadableFiles : [];
  const reasons = [];

  if (files === 0) {
    reasons.push('未发现可分析源码文件（扫描为空，可能被排除规则误伤或路径不对）');
  }
  if (parseErrors > 0 && filesParsed === 0 && files > 0) {
    reasons.push(`全部 ${files} 个文件解析失败（常见原因：tree-sitter 原生依赖未安装）`);
  } else if (parseErrors > 0) {
    reasons.push(`${parseErrors}/${files} 个文件解析失败`);
  }
  if (truncated) {
    reasons.push('扫描达到文件上限，结果可能被截断');
  }
  if (unreadableDirs.length > 0) {
    reasons.push(`${unreadableDirs.length} 个目录不可读，扫描可能漏文件`);
  }
  if (unreadableFiles.length > 0) {
    reasons.push(`${unreadableFiles.length} 个文件不可读，无法确认其结构`);
  }
  if (stats.layerConfigError) {
    reasons.push('分层配置无效：' + String(stats.layerConfigError));
  }

  let status = 'ok';
  if (files === 0 || (files > 0 && filesParsed === 0 && parseErrors > 0)) {
    status = 'failed';
  } else if (reasons.length > 0) {
    status = 'incomplete';
  }

  const allowGreen = status === 'ok';
  let finding = null;
  let message = null;

  if (status === 'failed') {
    finding = {
      rule: 'analysis-failed',
      severity: 'high',
      title: '分析失败，不能视为通过',
      detail: reasons.join('；'),
      confidence: 'high',
      file: null,
      line: null
    };
    message = `❌ 分析失败 — ${reasons.join('；')}。这不是「没有串门」，请先修复解析/扫描后再验收。`;
  } else if (status === 'incomplete') {
    finding = {
      rule: 'analysis-incomplete',
      severity: 'medium',
      title: '分析结果不完整，不能视为绿灯',
      detail: reasons.join('；'),
      confidence: 'high',
      file: null,
      line: null,
      meta: skippedDirs.length ? { skippedDevDirs: skippedDirs } : undefined
    };
    message = `⚠️ 分析不完整 — ${reasons.join('；')}。已有结果仅供参考，不能当作「没有串门」。`;
  }

  return {
    status,
    allowGreen,
    reasons,
    stats: {
      files,
      filesParsed,
      parseErrors,
      truncated,
      skippedDevDirs: skippedDirs,
      unreadableDirs,
      unreadableFiles
    },
    finding,
    message
  };
}

/**
 * 把完整性 finding 并入列表，并在不允许绿灯时抬升 riskSummary。
 * @param {object[]} findings
 * @param {object} riskSummary - summarizeFindings 结果
 * @param {ReturnType<typeof assessAnalysisCompleteness>} completeness
 */
function applyCompletenessToRisk(findings, riskSummary, completeness) {
  const list = Array.isArray(findings) ? findings.slice() : [];
  if (completeness && completeness.finding) {
    const already = list.some((f) => f && (f.rule === 'analysis-failed' || f.rule === 'analysis-incomplete'));
    if (!already) list.unshift(completeness.finding);
  }
  const summary = riskSummary && typeof riskSummary === 'object'
    ? { ...riskSummary, counts: { ...(riskSummary.counts || {}) } }
    : { level: 'none', counts: { high: 0, medium: 0, low: 0, info: 0 } };

  if (!completeness || completeness.allowGreen) {
    return { findings: list, riskSummary: summary };
  }

  return { findings: list, riskSummary: { ...summary, ...summarizeFindings(list) } };
}

function serializeAnalysis(completeness) {
  if (!completeness) return null;
  return {
    status: completeness.status || 'ok',
    allowGreen: completeness.allowGreen !== false && completeness.status === 'ok',
    reasons: Array.isArray(completeness.reasons) ? completeness.reasons : []
  };
}

/** 首发只承诺 CLI + MCP；扩展 / 多仓不在质量承诺内。 */
const FIRST_RELEASE_SCOPE = Object.freeze({
  promised: Object.freeze(['cli', 'mcp']),
  outOfScope: Object.freeze(['vscode-extension', 'multi-repo-workspace', 'saas', 'auto-merge-gate'])
});

module.exports = {
  assessAnalysisCompleteness,
  applyCompletenessToRisk,
  serializeAnalysis,
  FIRST_RELEASE_SCOPE
};
