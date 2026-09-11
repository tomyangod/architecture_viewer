'use strict';

const { formatPullRequestComment } = require('../../../lib/pr-comment');

const MARKER = '<!-- av-drift-bot -->';

const ERROR_HEADINGS = {
  NO_BASELINE: '无法对照基线',
  SCAN_FAILED: '代码扫描失败',
  RULES_CONFIG_ERROR: '团队规则配置错误'
};

const ERROR_HINTS = {
  NO_BASELINE: '没有可解析的 PR base / git HEAD / `.av/graph-baseline.json`，无法做增量结构检查。',
  SCAN_FAILED: '本轮代码无法完成结构扫描，请查看日志中的解析错误。',
  RULES_CONFIG_ERROR: '团队规则文件存在但读取/解析失败。本次未按默认规则替代出结论，请修复规则文件后重跑。'
};

function formatNoBaseline(result) {
  const heading = ERROR_HEADINGS[result.reason] || '检查未完成';
  const lines = [
    MARKER,
    '## Architecture Viewer · 增量结构验收',
    '',
    '**结果：' + heading + '**',
    result.repo ? ('仓库：`' + result.repo + '`') : '',
    result.pr ? ('PR：#' + result.pr) : '',
    result.sha ? ('提交：`' + String(result.sha).slice(0, 12) + '`') : '',
    '',
    result.message || ERROR_HINTS[result.reason] || '检查未能完成。',
    '',
    '本地复现：',
    '',
    '```bash',
    'npx arch-viewer session report',
    '```',
    '',
    '---',
    result.pr
      ? '*Pro 托管门禁 · 对照 PR base 做增量结构风险，不需要你在仓库里维护 Action。*'
      : '*Pro 本地检查 · 对照 git HEAD（或 session 快照）做增量结构风险。*'
  ].filter((x, i, arr) => !(x === '' && arr[i - 1] === ''));
  return lines.join('\n');
}

function formatComment(result) {
  if (!result) return MARKER + '\n';
  if (result.reason === 'NO_BASELINE' || result.reason === 'SCAN_FAILED' || result.reason === 'RULES_CONFIG_ERROR' || !result.diff) {
    return formatNoBaseline(result);
  }

  const md = formatPullRequestComment({
    diff: result.diff,
    impact: result.impact,
    findings: result.findings || [],
    riskSummary: result.riskSummary,
    baseRef: result.baseSha || result.baseRef,
    headRef: result.sha || result.headRef,
    baselineChanged: !!result.baselineChanged
  });
  const body = md.replace(/^<!-- arch-viewer:architecture-diff -->\s*/, '');
  const hosted = result.pr
    ? '*Pro 托管门禁 · 增量结构风险（对照 PR base），不需要你在仓库里维护 Action。*'
    : '*Pro 本地检查 · 增量结构风险（对照 git HEAD / session 快照）。*';
  return [MARKER, body.trimEnd(), '', hosted].join('\n');
}

module.exports = { MARKER, formatComment };
