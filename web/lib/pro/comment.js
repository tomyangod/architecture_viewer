'use strict';

const MARKER = '<!-- av-drift-bot -->';

function formatComment(result) {
  const ok = !!(result && result.ok);
  const title = ok ? '绿灯 · 图与代码一致' : '红灯 · 架构图漂移';
  const lines = [
    MARKER,
    '## Architecture Viewer · 托管漂移检查',
    '',
    '**结果：' + title + '**',
    result.repo ? ('仓库：`' + result.repo + '`') : '',
    result.pr ? ('PR：#' + result.pr) : '',
    result.sha ? ('提交：`' + String(result.sha).slice(0, 12) + '`') : '',
    ''
  ].filter((x, i, arr) => !(x === '' && arr[i - 1] === ''));

  const protocol = (result.protocol && result.protocol.errors) || [];
  const missing = (result.drift && result.drift.missing) || [];

  if (!result.kit) {
    lines.push('未找到 `architecture_viewer/` 套件。请在仓库运行：');
    lines.push('');
    lines.push('```bash');
    lines.push('npx arch-viewer init .');
    lines.push('npx arch-viewer generate .');
    lines.push('```');
  } else {
    if (protocol.length) {
      lines.push('### 协议失败');
      protocol.slice(0, 12).forEach((e) => lines.push('- ' + e));
      lines.push('');
    }
    if (missing.length) {
      lines.push('### 漂移（代码有、图上没有）');
      missing.slice(0, 20).forEach((m) => {
        lines.push('- `' + (m.kind || 'item') + '` **' + (m.label || m.term) + '**');
      });
      lines.push('');
    }
    if (ok) {
      lines.push('协议与漂移检查均通过。继续保持图随 PR 更新。');
    } else {
      lines.push('本地修复：');
      lines.push('');
      lines.push('```bash');
      lines.push('npx arch-viewer generate .');
      lines.push('npx arch-viewer check architecture_viewer --filled --drift --repo .');
      lines.push('```');
    }
  }

  lines.push('');
  lines.push('---');
  if (result.pr) {
    lines.push('*Pro 托管门禁 · 不需要你在仓库里维护 Action。Community 仍可用自托管模板。*');
  } else {
    lines.push('*Pro 本地检查 · 图与代码对不上时控制台变红，可推企业微信。*');
  }
  return lines.join('\n');
}

module.exports = { MARKER, formatComment };
