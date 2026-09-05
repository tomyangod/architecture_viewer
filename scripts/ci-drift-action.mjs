#!/usr/bin/env node
'use strict';

/**
 * CI：check --drift --rules → PR 评论（视图名、缺失项、建议动作）。
 *
 *   node scripts/ci-drift-action.mjs --kit <dir> [--repo <root>] [--rules <file>]
 *     [--filled] [--drift] [--no-drift] [--comment-on-pass] [--no-comment]
 *     [--out comment.md] [--json] [--post]
 *
 * 退出码：协议 / 漂移 / 规范任一失败为 1；参数错误为 2。
 * 无漂移时默认不评论（--comment-on-pass 可改为贴通过）。
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { checkKit, findKitDir } = require('../lib/index.js');
const { formatRuleViolations } = require('../lib/rules.js');
const { postPullRequestComment } = require('../lib/pr-comment.js');
const { enrichDriftItems, DIAGRAM_VIEWS } = require('../lib/drift-locate.js');

const MARKER = '<!-- arch-viewer:architecture-drift -->';
const HOMEPAGE = 'https://gitee.com/heyangyan/architecture_viewer';

export { MARKER, parseCli, runDriftCheck, formatDriftComment, postDriftComment };

function parseCli(argv) {
  const out = { _: [], drift: true, comment: true, commentOnPass: false, post: false, filled: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kit' || a === '--repo' || a === '--rules' || a === '--out') {
      out[a.slice(2)] = argv[++i];
    } else if (a === '--filled') out.filled = true;
    else if (a === '--drift') out.drift = true;
    else if (a === '--no-drift') out.drift = false;
    else if (a === '--comment-on-pass') out.commentOnPass = true;
    else if (a === '--no-comment') out.comment = false;
    else if (a === '--post') out.post = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out._.push(a);
  }
  if (!out.kit && out._[0]) out.kit = out._[0];
  if (process.env.ARCH_DRIFT_COMMENT_ON_PASS === '1') out.commentOnPass = true;
  return out;
}

function runDriftCheck(opts) {
  const kitDir = path.resolve(opts.kit);
  const result = checkKit(kitDir, {
    requireFilled: !!opts.filled,
    drift: !!opts.drift,
    repo: opts.repo ? path.resolve(opts.repo) : undefined,
    rules: opts.rules || undefined
  });
  return result;
}

function suggestActions(result) {
  const actions = [];
  const proto = (result.protocol && result.protocol.errors) || [];
  if (proto.some((e) => /NOT DECLARED/.test(e))) {
    actions.push('在对应视图的 Rel 之前补上节点声明，或删掉指向不存在 id 的 Rel');
  }
  if (proto.some((e) => /placeholder|占位/i.test(e))) {
    actions.push('替换模板占位文案（[你的项目名称] / 用户角色A / 服务A）为真实架构');
  }
  if (result.drift && result.drift.missing && result.drift.missing.length) {
    actions.push('把缺失模块画进对应视图，或运行 `npx arch-viewer generate .` 重生成骨架');
  }
  const kinds = new Set((result.rules && result.rules.violations || []).map((v) => v.kind));
  if (kinds.has('naming')) {
    actions.push('把违规节点 id 改成规则要求的命名（默认小写 snake_case）');
  }
  if (kinds.has('cross_layer')) {
    actions.push('拆除跨层 Rel，经 service 层中转（见 architecture-rules.yaml 的 layers）');
  }
  if (kinds.has('rel_whitelist')) {
    actions.push('把 Rel 标签换成白名单中的动词（HTTP / gRPC / SQL / 调用 / 访问 …）');
  }
  if (!actions.length && !result.ok) {
    actions.push('本地运行 `npx arch-viewer check <kit> --filled --drift --repo . --rules architecture-rules.yaml` 复检');
  }
  if (result.ok) {
    actions.push('无漂移。合入后如有架构变更，记得提交更新后的图源。');
  }
  return actions;
}

function viewLabel(file) {
  const v = DIAGRAM_VIEWS.find((x) => x.file === file);
  return v ? v.label : file;
}

function formatDriftComment(result, opts) {
  const kit = (opts && opts.kit) || (result.protocol && result.protocol.dir) || '';
  const repoRoot = opts && opts.repo ? path.resolve(opts.repo) : null;
  const lines = [MARKER];
  lines.push('## 🏛️ 架构漂移 / 规范检查');
  lines.push('');
  const protoN = ((result.protocol && result.protocol.errors) || []).length;
  const rawMissing = (result.drift && result.drift.missing) || [];
  const driftN = rawMissing.length;
  const ruleN = (result.rules && result.rules.violations && result.rules.violations.length) || 0;
  // W10-02：精确定位缺失项（视图 + 源码行号 + 修复 prompt）
  const enriched = driftN ? enrichDriftItems(rawMissing, repoRoot, kit) : [];
  if (result.ok) {
    lines.push('**结果：✅ 通过** · 协议 / 漂移 / 团队规范均无红灯。');
    lines.push('');
    lines.push(footer(opts));
    return lines.join('\n');
  }
  lines.push(`**结果：❌ 未通过** · 协议 ${protoN} · 漂移 ${driftN} · 规范 ${ruleN}`);
  lines.push('');

  if (protoN) {
    lines.push('### 视图协议');
    lines.push('');
    for (const e of result.protocol.errors) {
      if (/^\s+修复:/.test(e)) continue;
      lines.push(`- ${e}`);
    }
    lines.push('');
  }

  if (driftN) {
    lines.push('### 漂移（代码有、图没有）');
    lines.push('');
    for (const m of enriched) {
      const loc = m.source
        ? ` · 源码 \`${m.source.file}${m.source.line ? ':' + m.source.line : ''}\``
        : '';
      lines.push(`- **${m.kind}** \`${m.label}\` → 应补入 [\`${m.view}\`](${m.view})（${viewLabel(m.view)}）${loc}`);
    }
    lines.push('');
    lines.push('### 一键修复 Prompt（粘贴给 Cursor / AI 编辑器）');
    lines.push('');
    lines.push('```');
    enriched.forEach((m, i) => {
      lines.push(`# 缺失项 ${i + 1}/${enriched.length}：${m.label}`);
      lines.push(m.prompt);
      lines.push('');
    });
    lines.push('```');
    lines.push('');
  }

  if (ruleN) {
    lines.push('### 团队规范');
    lines.push('');
    for (const line of formatRuleViolations(result.rules)) {
      lines.push(`- ${line}`);
    }
    lines.push('');
  }

  const actions = suggestActions(result);
  if (actions.length) {
    lines.push('### 建议动作');
    lines.push('');
    actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push('');
  }

  if (kit) lines.push(`<sub>kit \`${kit}\`</sub>`);
  lines.push('');
  lines.push(footer(opts));
  return lines.join('\n');
}

function footer(opts) {
  const extra = opts && opts.repo ? ` · repo \`${opts.repo}\`` : '';
  return `<sub>由 [arch-viewer](${HOMEPAGE}) 自动生成${extra} · 本地复现：\`npx arch-viewer check --filled --drift --repo .\`${opts && opts.rules ? ' `--rules ' + opts.rules + '`' : ''}</sub>`;
}

function shouldWriteComment(result, opts) {
  if (opts.comment === false) return false;
  if (!result.ok) return true;
  return !!opts.commentOnPass;
}

async function postGiteeComment({ token, body, owner, repo, number, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const api = (process.env.GITEE_API_URL || 'https://gitee.com/api/v5').replace(/\/$/, '');
  const url = `${api}/repos/${owner}/${repo}/pulls/${number}/comments`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'arch-viewer-bot' },
    body: JSON.stringify({ access_token: token, body })
  });
  if (!res.ok) throw new Error(`Gitee API 发布评论失败: ${res.status} ${await res.text()}`);
  const created = await res.json();
  return { action: 'created', url: created.html_url || created.url };
}

async function postDriftComment(body, opts) {
  if (opts.comment === false) return { action: 'skipped', reason: '--no-comment' };
  const giteeToken = process.env.GITEE_TOKEN;
  const owner = process.env.GITEE_OWNER;
  const repo = process.env.GITEE_REPO;
  const number = process.env.GITEE_PULL_REQUEST_NUMBER;
  if (giteeToken && owner && repo && number) {
    return postGiteeComment({
      token: giteeToken,
      body,
      owner,
      repo,
      number,
      fetchImpl: opts.fetchImpl
    });
  }
  return postPullRequestComment({
    token: process.env.GITHUB_TOKEN,
    body,
    marker: MARKER,
    fetchImpl: opts.fetchImpl
  });
}

function printHelp() {
  console.log(`Architecture Viewer CI drift action

Usage:
  node scripts/ci-drift-action.mjs --kit <dir> [--repo <root>] [--rules <file>]
    [--filled] [--drift|--no-drift] [--comment-on-pass] [--no-comment]
    [--out comment.md] [--json] [--post]

Exit 1 if protocol, drift, or architecture-rules fail.
On pass, skip the PR comment unless --comment-on-pass (or ARCH_DRIFT_COMMENT_ON_PASS=1).
`);
}

async function main(argv) {
  const opts = parseCli(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  let kit = opts.kit || process.cwd();
  kit = path.resolve(kit);
  if (!fs.existsSync(path.join(kit, 'architecture_visualized.html'))) {
    const found = findKitDir(kit);
    if (found) kit = found;
  }
  if (!fs.existsSync(kit)) {
    console.error('Kit not found: ' + kit);
    return 2;
  }
  opts.kit = kit;
  const result = runDriftCheck(opts);
  const comment = formatDriftComment(result, opts);
  if (opts.out) fs.writeFileSync(path.resolve(opts.out), comment);
  if (opts.json) {
    console.log(JSON.stringify({
      ok: result.ok,
      kit,
      protocolErrors: (result.protocol && result.protocol.errors) || [],
      driftMissing: (result.drift && result.drift.missing) || [],
      rules: result.rules,
      comment
    }, null, 2));
  } else {
    process.stderr.write(comment + '\n');
  }
  if (shouldWriteComment(result, opts) && opts.post) {
    try {
      const posted = await postDriftComment(comment, opts);
      console.error('PR comment: ' + posted.action + (posted.url ? ' ' + posted.url : '') + (posted.reason ? ' (' + posted.reason + ')' : ''));
    } catch (e) {
      console.error('PR comment failed: ' + e.message);
    }
  } else if (!result.ok) {
    console.error('Comment ready (not posted). Use --post in a PR job, or --out file.md');
  }
  return result.ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  }).catch((e) => {
    console.error(e);
    process.exit(2);
  });
}

export { main, shouldWriteComment, suggestActions, postGiteeComment };
