'use strict';

/**
 * 对话内结构验收 verdict（≤3 行）。
 * HTML 报告降为可选深挖链接，不再作为主路径。
 */

const { describeGreenLight } = require('./green-light');

const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 };

function lightMeta(level) {
  switch (level) {
    case 'high':
      return { icon: '🔴', label: '结构验收未通过' };
    case 'medium':
      return { icon: '🟠', label: '结构验收需关注' };
    case 'low':
      return { icon: '🔵', label: '结构验收有提示' };
    case 'incomplete':
    case 'failed':
      return { icon: '⚠️', label: '分析结果不可作为通过' };
    default:
      return { icon: '🟢', label: '结构验收通过' };
  }
}

function pickTopFinding(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  let best = null;
  let bestRank = Infinity;
  for (const f of findings) {
    const rank = SEVERITY_RANK[f && f.severity] ?? 9;
    if (rank < bestRank) {
      best = f;
      bestRank = rank;
    }
  }
  return best;
}

function changePhrase(summary, scopeChanged) {
  const s = summary || {};
  const total = Number(s.totalChanges) || 0;
  const impl = Number(s.implChangedCount) || 0;
  const scopeNote = scopeChanged ? '（含分析范围变化）' : '';
  if (total > 0) return `${total} 项结构变更${scopeNote}`;
  if (impl > 0) return `${impl} 个函数体变化`;
  if (s.sourceChanged === true) return '源码有改动（结构未变）';
  if (s.sourceChanged === false) return '源码与结构均未变';
  return '0 项结构变更';
}

function riskPhrase(riskSummary, findings) {
  const counts = (riskSummary && riskSummary.counts) || {};
  const fromCounts = (counts.high || 0) + (counts.medium || 0) + (counts.low || 0) + (counts.info || 0);
  const n = Array.isArray(findings) && findings.length > 0
    ? findings.length
    : fromCounts;
  if (n === 0) return '0 项风险';
  const parts = [];
  if (counts.high) parts.push(`HIGH ${counts.high}`);
  if (counts.medium) parts.push(`MEDIUM ${counts.medium}`);
  if (counts.low) parts.push(`LOW ${counts.low}`);
  if (counts.info) parts.push(`INFO ${counts.info}`);
  if (parts.length) return `${n} 项风险（${parts.join(' / ')}）`;
  return `${n} 项风险`;
}

function topFindingLine(finding) {
  if (!finding) return null;
  const rule = finding.rule || null;
  const title = finding.title || null;
  let head;
  if (title && rule && title !== rule) head = `${title}（${rule}）`;
  else head = title || rule || 'finding';
  const file = finding.file || null;
  const where = file ? ` · ${file}${finding.line != null ? `:${finding.line}` : ''}` : '';
  return `最严重：${head}${where}`;
}

function normalizeReportPath(reportPath) {
  if (!reportPath) return '.av/session-report.html';
  const s = String(reportPath).replace(/\\/g, '/');
  const idx = s.lastIndexOf('/.av/');
  if (idx >= 0) return s.slice(idx + 1);
  if (s.endsWith('session-report.html') || s.endsWith('session-report-builtin.html')) {
    return `.av/${s.split('/').pop()}`;
  }
  return s;
}

/**
 * @param {object} opts
 * @param {{ level?: string, counts?: object }} [opts.riskSummary]
 * @param {Array} [opts.findings]
 * @param {object} [opts.summary] diff.summary
 * @param {string|null} [opts.reportPath]
 * @param {string} [opts.baselineKind] 'snapshot' | 'git-head'（预留）
 * @param {boolean} [opts.hasUncommitted] 预留
 * @param {object|null} [opts.awareness] buildAwareness() result
 * @returns {{ level: string, lines: string[], text: string, topFinding: object|null, reportPath: string, awarenessLine: string|null }}
 */
function formatSessionVerdict(opts = {}) {
  const riskSummary = opts.riskSummary || { level: 'none' };
  const findings = opts.findings || [];
  const summary = opts.summary || {};
  const completeness = opts.analysisCompleteness || null;
  const level = (!completeness || completeness.allowGreen)
    ? (riskSummary.level || 'none')
    : (completeness.status === 'failed' ? 'high' : (riskSummary.level === 'none' ? 'medium' : riskSummary.level));
  const meta = (!completeness || completeness.allowGreen)
    ? lightMeta(level)
    : { icon: '⚠️', label: completeness.status === 'failed' ? '分析失败' : '分析不完整' };
  const reportPath = normalizeReportPath(opts.reportPath);
  const topFinding = level === 'none' ? null : pickTopFinding(findings);
  const { formatAwarenessLine } = require('./awareness');
  const awarenessLine = formatAwarenessLine(opts.awareness || null);

  const line1 = `${meta.icon} ${meta.label} · ${riskPhrase(riskSummary, findings)} · ${changePhrase(summary, !!opts.scopeChanged)}`;
  let line2;
  if (completeness && !completeness.allowGreen) {
    line2 = completeness.message || (completeness.reasons || []).join('；') || '分析结果不可作为通过';
  } else if (awarenessLine) {
    // Perception beats "最严重：broad-impact" for the second line; gate detail stays in HTML.
    line2 = awarenessLine.length > 160 ? awarenessLine.slice(0, 157) + '…' : awarenessLine;
  } else if (level === 'none') {
    line2 = describeGreenLight(summary).mcpShort;
  } else {
    line2 = topFindingLine(topFinding) || `共 ${findings.length} 条 finding（无文件定位）`;
  }

  const extras = [];
  if (summary.sourceComparison === 'incompatible-hash-version') {
    extras.push('旧基线内容哈希版本不同，源码内容对比未知；请保留旧快照，在已确认版本上重建基线');
  }
  if (opts.baselineKind === 'git-head') extras.push('对照 git HEAD');
  if (opts.baselineKind === 'snapshot') extras.push('对照会话快照（非 git HEAD）');
  if (opts.hasUncommitted) extras.push('含未提交改动');
  if (opts.scopeChanged) {
    const sc = opts.scopeChanged;
    const bits = [];
    if ((sc.added || []).length) bits.push(`新增排除 ${sc.added.join('、')}`);
    if ((sc.removed || []).length) bits.push(`移除排除 ${sc.removed.join('、')}`);
    extras.push(`分析范围变化（${bits.join('；')}，非代码删除）`);
  }
  if (completeness && !completeness.allowGreen) extras.push('禁止绿灯');
  const line3 = extras.length
    ? `详情（可选）：${reportPath} · ${extras.join(' · ')}`
    : `详情（可选）：${reportPath}`;

  const lines = [line1, line2, line3].filter((l) => l != null && String(l).trim() !== '');
  return {
    level,
    lines,
    text: lines.join('\n'),
    topFinding,
    reportPath,
    awarenessLine
  };
}

/** nextStep：HTML 不再是必经。git HEAD 基线时 commit=接受；无 git 才提 session start。 */
function nextStepForVerdict(verdict, opts = {}) {
  const level = (verdict && verdict.level) || 'none';
  const implN = (opts.summary && opts.summary.implChangedCount) || 0;
  const git = opts.baselineKind === 'git-head';
  const accept = git
    ? 'commit 即接受当前结构。'
    : '确认后可用 av_session_start 刷新基线。';
  if (level === 'high') {
    return `先处理红灯（可用 av_explain_finding 看修法），修完再调 av_session_report 复查。需要图再打开详情链接；${accept}`;
  }
  if (level === 'medium') {
    return `建议看黄灯；确认可接受后再继续。需要图再打开详情链接；${accept}`;
  }
  if (level === 'low') {
    return `蓝灯可稍后处理。需要图再打开详情链接；${accept}`;
  }
  if (implN > 0) {
    return `本轮有 ${implN} 个函数体实现变化，请配合测试与审查。详情链接可选；${accept}`;
  }
  return git
    ? '可继续开发或提交。commit 即接受当前结构。详情链接可选。'
    : '可继续开发或提交。详情链接可选；确认后可用 av_session_start 刷新基线。';
}

module.exports = {
  formatSessionVerdict,
  nextStepForVerdict,
  pickTopFinding,
  normalizeReportPath
};
