'use strict';

// T2 PR 架构评论：diff + impact + findings → Markdown 评论，
// 可直接贴到 GitHub / Gitee PR；postPullRequestComment() 通过 GitHub REST
// 发布评论，并按 marker 幂等更新（同一 PR 反复 push 只刷楼不刷屏）。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describeGreenLight } = require('./green-light');

const COMMENT_MARKER = '<!-- arch-viewer:architecture-diff -->';
const BASELINE_REL = path.join('.av', 'graph-baseline.json');
const HOMEPAGE = 'https://gitee.com/heyangyan/architecture_viewer';

const RISK_BADGE = {
  high: '🔴 高风险',
  medium: '🟠 中风险',
  low: '🔵 低风险',
  none: '✅ 无显著风险'
};

const SEV_EMOJI = { high: '🔴', medium: '🟠', low: '🔵', info: '⚪' };

const MAX_IMPACT_ITEMS = 15;
const MAX_DOWNSTREAM_NAMES = 5;
const MAX_FINDING_DETAIL = 20;
const MAX_WASH_FINDINGS = 8;

function esc(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function code(s) {
  return '`' + String(s == null ? '' : s).replace(/`/g, '\\`') + '`';
}

/**
 * Compare `.av/graph-baseline.json` between two checkouts (base vs head).
 * True when the file is added, removed, or content-changed.
 */
function baselineFileChanged(baseDir, headDir) {
  if (!baseDir || !headDir) return false;
  const a = path.join(path.resolve(baseDir), BASELINE_REL);
  const b = path.join(path.resolve(headDir), BASELINE_REL);
  const aEx = fs.existsSync(a);
  const bEx = fs.existsSync(b);
  if (!aEx && !bEx) return false;
  if (aEx !== bEx) return true;
  try {
    return fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8');
  } catch {
    return true;
  }
}

/**
 * Detect baseline change via `git diff` against a base SHA (CI).
 * Env fallbacks: GITHUB_BASE_SHA / GITHUB_EVENT_BEFORE.
 */
function baselineChangedViaGit(repoRoot, baseSha) {
  const sha = baseSha || process.env.GITHUB_BASE_SHA || process.env.GITHUB_EVENT_BEFORE;
  if (!sha || !repoRoot) return false;
  const r = spawnSync(
    'git',
    ['diff', '--name-only', `${sha}...HEAD`, '--', BASELINE_REL],
    { cwd: path.resolve(repoRoot), encoding: 'utf8' }
  );
  if (r.status !== 0) return false;
  return String(r.stdout || '').split(/\r?\n/).some((l) => l.trim().endsWith('graph-baseline.json'));
}

/**
 * Markdown block: baseline refresh needs human confirmation (anti-wash).
 */
function formatBaselineWashWarning({ findings = [], riskSummary } = {}) {
  const lines = [];
  lines.push('### ⚠️ 基线刷新需人工确认（防洗白）');
  lines.push('');
  lines.push(
    '本 PR **修改了** `.av/graph-baseline.json`。刷新基线等于把当前结构认作「新的正常」——' +
    '若顺手把未处理的红灯写进基线，后续 session 将不再报这些债。'
  );
  lines.push('');
  lines.push('**请评审确认**：');
  lines.push('1. 基线变更是有意的（架构已按预期演进），不是为了让 CI / session 变绿；');
  lines.push('2. 下列本轮 findings 已逐条处理或明确接受为新常态；');
  lines.push('3. PR 描述写明刷新理由（或链到架构评审记录）。');
  lines.push('');
  const highs = findings.filter((f) => f.severity === 'high');
  const mediums = findings.filter((f) => f.severity === 'medium');
  const level = (riskSummary && riskSummary.level) || (highs.length ? 'high' : mediums.length ? 'medium' : 'none');
  const total = (riskSummary && riskSummary.total) != null
    ? riskSummary.total
    : findings.length;
  lines.push(`**本轮 findings 摘要**：风险 ${RISK_BADGE[level] || RISK_BADGE.none} · 共 ${total} 条` +
    (highs.length || mediums.length
      ? `（高 ${highs.length} / 中 ${mediums.length}）`
      : '（无中高风险）'));
  lines.push('');
  const show = [...highs, ...mediums].slice(0, MAX_WASH_FINDINGS);
  if (show.length) {
    for (const f of show) lines.push(formatFinding(f));
    const more = highs.length + mediums.length - show.length;
    if (more > 0) lines.push(`- …另有 ${more} 条中高风险，本地 \`npx arch-viewer session report\` 查看`);
  } else {
    lines.push('- （当前对比未检出中高风险 finding；仍请确认基线 diff 本身合理）');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * 生成 PR 评论 Markdown。
 * @param {object} p
 * @param {object} p.diff        diffGraphs() 结果
 * @param {object} p.impact      computeImpact() 结果
 * @param {Array}  p.findings    evaluateRisk() 结果
 * @param {object} [p.riskSummary] summarizeFindings() 结果（缺省时内部不重算，用 findings 长度推断）
 * @param {string} [p.baseRef]   base 引用（sha/分支），用于页脚
 * @param {string} [p.headRef]   head 引用
 * @param {boolean} [p.baselineChanged] 本 PR 是否改了 .av/graph-baseline.json
 * @returns {string} Markdown（含 marker 注释，首行）
 */
/**
 * 分析范围变化提示：ignore 配置变更导致的实体消失不是代码删除。
 */
function formatScopeNotice(scopeChanged) {
  if (!scopeChanged) return '';
  const parts = [];
  if ((scopeChanged.added || []).length) {
    parts.push('新增排除：`' + scopeChanged.added.join('`、`') + '`');
  }
  if ((scopeChanged.removed || []).length) {
    parts.push('移除排除：`' + scopeChanged.removed.join('`、`') + '`');
  }
  return '**🔎 分析范围变化**：`.arch-viewer-ignore` / `externalDirs` 本轮调整（' +
    parts.join('；') +
    '）。计数中位于这些目录的实体增减来自排除配置，不代表真实代码删除或新增。';
}

function formatPullRequestComment({
  diff, impact, findings = [], riskSummary, baseRef, headRef, baselineChanged
}) {
  const s = diff.summary || {};
  const level = (riskSummary && riskSummary.level) || 'none';
  const totalChanges = s.totalChanges || 0;

  const lines = [];
  lines.push(COMMENT_MARKER);
  lines.push('## 🏛️ 架构变更影响面');
  lines.push('');

  if (baselineChanged) {
    lines.push(formatBaselineWashWarning({ findings, riskSummary }));
  }

  if (diff.scopeChanged) {
    lines.push(formatScopeNotice(diff.scopeChanged));
    lines.push('');
  }

  if (totalChanges === 0) {
    if (!baselineChanged) {
      lines.push(describeGreenLight(s).pr);
      lines.push('');
    } else {
      lines.push('**说明**：代码图谱相对对比无结构 diff，但基线文件本身有变更——仍须按上方洗白提醒确认。');
      lines.push('');
    }
    lines.push(footer(baseRef, headRef, baselineChanged));
    return lines.join('\n');
  }

  lines.push(`**风险等级：${RISK_BADGE[level] || RISK_BADGE.none}** · 被改实体 ${impact ? impact.changedCount : 0} 个 · 受影响下游 ${impact ? impact.impactedCount : 0} 个`);
  lines.push('');

  // —— 变更计数表 ——
  lines.push('| 类别 | 新增 | 删除 | 修改 | 重命名 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  lines.push(`| 实体 | ${s.addedNodes || 0} | ${s.removedNodes || 0} | ${s.modifiedNodes || 0} | ${s.renamedNodes || 0} |`);
  lines.push(`| 类型 | ${s.addedTypes || 0} | ${s.removedTypes || 0} | — | — |`);
  lines.push(`| 依赖边 | ${s.addedArchitecturalEdges != null ? s.addedArchitecturalEdges : (s.addedEdges || 0)} | ${s.removedArchitecturalEdges != null ? s.removedArchitecturalEdges : (s.removedEdges || 0)} | — | — |`);
  lines.push(`| 外部依赖 | ${s.addedExternalDeps || 0} | ${s.removedExternalDeps || 0} | — | — |`);
  lines.push(`| 包 | ${s.addedPackages || 0} | ${s.removedPackages || 0} | — | — |`);
  lines.push('');

  // —— 新增外部依赖清单（评审最关心） ——
  if ((diff.addedExternalDeps || []).length) {
    const thirdParty = diff.addedExternalDeps.filter((d) => !d.builtin);
    const builtin = diff.addedExternalDeps.filter((d) => d.builtin);
    if (thirdParty.length) {
      lines.push(`**📦 新增第三方依赖：** ${thirdParty.map((d) => code(d.name || d.id)).join('、')}`);
    }
    if (builtin.length) {
      lines.push(`**🔌 新增标准库依赖：** ${builtin.map((d) => code(d.name || d.id)).join('、')}`);
    }
    lines.push('');
  }
  if ((diff.removedExternalDeps || []).length) {
    lines.push(`**🗑️ 移除外部依赖：** ${diff.removedExternalDeps.map((d) => code(d.name || d.id)).join('、')}`);
    lines.push('');
  }

  // —— 风险 findings：高/中全列，低/info 折叠计数 ——
  const highs = findings.filter((f) => f.severity === 'high');
  const mediums = findings.filter((f) => f.severity === 'medium');
  const lows = findings.filter((f) => f.severity === 'low');
  const infos = findings.filter((f) => f.severity === 'info');

  if (highs.length || mediums.length) {
    lines.push('### ⚠️ 风险发现');
    lines.push('');
    for (const f of [...highs, ...mediums].slice(0, MAX_FINDING_DETAIL)) {
      lines.push(formatFinding(f));
    }
    const folded = highs.length + mediums.length - Math.min(highs.length + mediums.length, MAX_FINDING_DETAIL);
    if (folded > 0) lines.push(`- …另有 ${folded} 条中高风险发现，本地运行 \`npx arch-viewer session report --all\` 查看`);
    if (lows.length) lines.push(`- 🔵 ${lows.length} 条低风险发现已折叠`);
    if (infos.length) lines.push(`- ⚪ ${infos.length} 条提示性发现已折叠`);
    lines.push('');
  }

  // —— 影响面 ——
  if (impact && impact.items && impact.items.length) {
    lines.push('### 🔗 影响面（反向依赖：谁会被波及）');
    lines.push('');
    for (const it of impact.items.slice(0, MAX_IMPACT_ITEMS)) {
      const name = it.node && (it.node.name || it.id) || it.id;
      const directNames = it.direct.slice(0, MAX_DOWNSTREAM_NAMES).map((d) => code(d.name || d.id)).join('、');
      const more = it.direct.length > MAX_DOWNSTREAM_NAMES ? ` 等 ${it.direct.length} 个` : '';
      lines.push(
        `- **[${it.label}]** ${code(name)} → 直接下游 ${it.direct.length} 个` +
        (directNames ? `：${directNames}${more}` : '') +
        `，间接 ${it.transitive.length} 个`
      );
    }
    if (impact.items.length > MAX_IMPACT_ITEMS) {
      lines.push(`- …另有 ${impact.items.length - MAX_IMPACT_ITEMS} 个被改实体，运行 \`npx arch-viewer impact <base> <head> --json\` 查看全部`);
    }
    lines.push('');
  }

  lines.push('---');
  if (baselineChanged) {
    lines.push('**评审提示**：本 PR 含基线刷新——先确认上方「防洗白」清单，再合入；' +
      '高风险项（跨层违规 / 类型删除 / 层级穿透 / 循环依赖 / 新外部依赖）建议逐条确认。');
  } else {
    lines.push('**评审提示**：高风险项（跨层违规 / 类型删除 / 层级穿透 / 新外部依赖）建议逐条确认；' +
      '变更确认合入后，请在主干运行 `npx arch-viewer session start` 刷新架构基线。');
  }
  lines.push('');
  lines.push(footer(baseRef, headRef, baselineChanged));
  return lines.join('\n');
}

function formatFinding(f) {
  const emoji = SEV_EMOJI[f.severity] || '•';
  const where = f.file ? `（${f.file}${f.line ? ':' + f.line : ''}）` : '';
  const detail = f.detail ? ` — ${esc(f.detail)}` : '';
  return `- ${emoji} **${esc(f.title)}**：${esc(f.message)}${detail}${where ? ' ' + where : ''}`;
}

function footer(baseRef, headRef, baselineChanged) {
  const refs = baseRef || headRef
    ? `<sub>base ${code(baseRef ? baseRef.slice(0, 8) : '?')} → head ${code(headRef ? headRef.slice(0, 8) : '?')} · </sub>`
    : '';
  const wash = baselineChanged ? ' · 含基线变更（需人工确认）' : '';
  return `${refs}<sub>由 [arch-viewer](${HOMEPAGE}) 自动生成${wash} · 本地复现：\`npx arch-viewer impact <base> <head>\`</sub>`;
}

/**
 * 在 GitHub PR 上发布/更新评论（幂等：marker 匹配则更新原评论）。
 * 需要环境变量 GITHUB_TOKEN；PR 信息从 GITHUB_EVENT_PATH 自动解析。
 * @returns {Promise<{action: 'created'|'updated'|'skipped', url?: string, reason?: string}>}
 */
async function postPullRequestComment({ token, body, eventPath, marker = COMMENT_MARKER, fetchImpl } = {}) {
  const fetchFn = fetchImpl || fetch;
  const resolvedEventPath = eventPath || process.env.GITHUB_EVENT_PATH;
  if (!resolvedEventPath) {
    return { action: 'skipped', reason: '未找到 GITHUB_EVENT_PATH（不在 GitHub Actions PR 环境中运行）' };
  }
  let event;
  try {
    event = JSON.parse(require('fs').readFileSync(resolvedEventPath, 'utf8'));
  } catch (e) {
    return { action: 'skipped', reason: `无法解析 GITHUB_EVENT_PATH: ${e.message}` };
  }
  const pr = event.pull_request || event.issue;
  if (!pr) return { action: 'skipped', reason: '非 PR 事件（GITHUB_EVENT_PATH 中无 pull_request）' };

  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const commentsUrl = `${api}/repos/${pr.base.repo.full_name}/issues/${pr.number}/comments`;
  const headers = {
    Authorization: `Bearer ${token || process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'arch-viewer-bot'
  };

  // 查找已有评论（marker 幂等）
  const listRes = await fetchFn(commentsUrl, { headers });
  if (!listRes.ok) {
    throw new Error(`GitHub API 列出评论失败: ${listRes.status} ${await listRes.text()}`);
  }
  const comments = await listRes.json();
  const existing = comments.find((c) => c.body && c.body.includes(marker));

  if (existing) {
    const patchRes = await fetchFn(`${api}/repos/${pr.base.repo.full_name}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body })
    });
    if (!patchRes.ok) throw new Error(`GitHub API 更新评论失败: ${patchRes.status} ${await patchRes.text()}`);
    const updated = await patchRes.json();
    return { action: 'updated', url: updated.html_url };
  }

  const postRes = await fetchFn(commentsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body })
  });
  if (!postRes.ok) throw new Error(`GitHub API 发布评论失败: ${postRes.status} ${await postRes.text()}`);
  const created = await postRes.json();
  return { action: 'created', url: created.html_url };
}

module.exports = {
  formatPullRequestComment,
  postPullRequestComment,
  formatBaselineWashWarning,
  formatScopeNotice,
  baselineFileChanged,
  baselineChangedViaGit,
  COMMENT_MARKER,
  BASELINE_REL
};
