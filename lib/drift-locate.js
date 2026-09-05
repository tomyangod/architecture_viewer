'use strict';

/**
 * W10-02：漂移缺失项的精确定位与修复 prompt 生成。
 *
 * 把 checkDrift 返回的 missing 项（{term, label, kind}）增强为：
 *   - view:    该元素应出现在哪张图（c4-container / c4-component / …）
 *   - source:  源码里定义位置（file:line），方便 PR 评论直接跳转
 *   - prompt:  可直接粘贴给 Cursor / AI 编辑器的修复指令
 */

const fs = require('fs');
const path = require('path');
const { SKIP_DIRS, CODE_EXT } = require('./scan');

const DIAGRAM_VIEWS = [
  { file: 'c4-context.md',   label: 'C4 Context · 系统上下文' },
  { file: 'c4-container.md', label: 'C4 Container · 容器' },
  { file: 'c4-component.md', label: 'C4 Component · 组件' },
  { file: 'block-diagram.md', label: 'Block Diagram · 分层模块' },
  { file: 'class-diagram.md', label: 'Class Diagram · 类图' },
  { file: 'deployment-ops.md', label: 'Deployment · 部署运维' }
];

/** drift kind → 最可能出现的视图（按优先级） */
function viewsForKind(kind, label) {
  const l = String(label || '').toLowerCase();
  if (kind === 'service') {
    return ['c4-container.md', 'deployment-ops.md', 'c4-context.md'];
  }
  if (kind === 'entry') {
    return ['deployment-ops.md', 'c4-container.md'];
  }
  // module
  if (/deploy|k8s|infra|docker|ops|ci/i.test(l)) return ['deployment-ops.md', 'block-diagram.md'];
  if (/front|web|ui|client|dashboard/i.test(l)) return ['c4-component.md', 'block-diagram.md'];
  if (/worker|crawl|scraper|spider|collect|fetch|ingest|job|schedul/i.test(l))
    return ['c4-component.md', 'block-diagram.md', 'deployment-ops.md'];
  return ['c4-component.md', 'block-diagram.md', 'c4-container.md'];
}

/**
 * 在源码树中定位 term 出现的文件与行号。
 * 策略：把 snake_case term 还原为目录名 / CamelCase 类名，做浅遍历匹配。
 * 返回 { file, line, snippet } 或 null。
 */
function locateInSource(repoRoot, term, label) {
  const variants = buildVariants(term, label);
  const maxDepth = 6;
  const stack = [{ dir: repoRoot, depth: 0 }];
  let dirFallback = null;
  let checked = 0;
  while (stack.length && checked < 400) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) {
          const dirLeaf = ent.name.toLowerCase();
          // 目录名匹配（模块）作为兜底，优先继续找代码精确匹配
          if (!dirFallback && variants.dirNames.includes(dirLeaf)) {
            dirFallback = { file: path.relative(repoRoot, full) + '/', line: 1, snippet: ent.name + '/' };
          }
          stack.push({ dir: full, depth: depth + 1 });
        }
        continue;
      }
      if (!CODE_EXT.test(ent.name) || /test|spec|min\.js/i.test(ent.name)) continue;
      checked++;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const v of variants.codePatterns) {
          if (v.test(line)) {
            // 代码精确命中（带行号）优先返回
            return {
              file: path.relative(repoRoot, full),
              line: i + 1,
              snippet: line.trim().slice(0, 120)
            };
          }
        }
      }
    }
  }
  return dirFallback;
}

/** 把 term/label 转成多种匹配形式 */
function buildVariants(term, label) {
  const dirNames = new Set();
  const codePatterns = [];
  // term 是 snake_case：auth_service, internal_catalog
  const parts = String(term || '').split('_');
  // 目录名变体：叶子段
  const leaf = parts[parts.length - 1];
  if (leaf && leaf.length >= 3) dirNames.add(leaf);
  // label 可能是 "internal/catalog"，叶子目录名
  const labelLeaf = String(label || '').toLowerCase().split('/').pop();
  if (labelLeaf && labelLeaf.length >= 3) dirNames.add(labelLeaf);

  // CamelCase 类名：auth_service → AuthService
  const camel = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  if (camel.length >= 3) {
    codePatterns.push(new RegExp('\\b(class|interface|type|struct|func|function|const|def)\\s+' + escapeRe(camel) + '\\b'));
    // Go: type Service struct（叶子 CamelCase）
    const leafCamel = leaf.charAt(0).toUpperCase() + leaf.slice(1);
    codePatterns.push(new RegExp('\\b(class|interface|type|struct)\\s+' + escapeRe(leafCamel) + '\\b'));
  }
  // snake_case 标识符直接出现
  if (term && term.length >= 3) {
    codePatterns.push(new RegExp('\\b' + escapeRe(term) + '\\b'));
  }
  // 服务名（docker-compose service）：openim-push
  const serviceName = String(label || '').toLowerCase();
  if (serviceName.includes('-') || serviceName.includes('_')) {
    codePatterns.push(new RegExp('^\\s*' + escapeRe(serviceName.replace(/[-_]/g, '[-_]')) + '\\s*:'));
  }
  return { dirNames: [...dirNames], codePatterns };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成可直接粘贴给 Cursor 的修复 prompt。
 */
function buildFixPrompt(item, repoRoot) {
  const kindLabel = { service: '服务/容器', module: '模块/组件', entry: '入口' }[item.kind] || item.kind;
  const viewName = DIAGRAM_VIEWS.find((v) => v.file === item.view)?.label || item.view;
  const loc = item.source
    ? `源码定义位置：\`${item.source.file}${item.source.line ? ':' + item.source.line : ''}\``
    : '（未能自动定位源码，请人工确认模块路径）';
  const missing = item.kind === 'entry'
    ? `入口 \`${item.label}\` 未在部署/容器视图中体现`
    : `${kindLabel} \`${item.label}\` 在代码中存在，但架构图 \`${item.view}\`（${viewName}）中缺失`;

  return [
    `架构图漂移修复：${missing}。`,
    loc + '。',
    `请在 architecture_viewer/${item.view} 中补充该元素：`,
    `- 若该元素是内部模块，在 C4 Component / Block Diagram 中加节点并画出与相邻模块的 Rel；`,
    `- 若是可部署服务，在 C4 Container / Deployment 中加容器节点，标注技术栈与端口；`,
    `- 节点 id 用小写 snake_case，Rel 标签用白名单动词（HTTP/gRPC/SQL/调用/访问/读写）；`,
    `- 不要改动与本次漂移无关的节点。改完运行 npx arch-viewer check --filled --drift --repo . 复检。`
  ].join('\n');
}

/**
 * 批量增强 drift.missing：补 view / source / prompt。
 */
function enrichDriftItems(missing, repoRoot, kitDir) {
  return (missing || []).map((m) => {
    const views = viewsForKind(m.kind, m.label);
    const view = pickView(views, kitDir);
    const source = repoRoot ? locateInSource(repoRoot, m.term, m.label) : null;
    const enriched = Object.assign({}, m, { view, source });
    enriched.prompt = buildFixPrompt(enriched, repoRoot);
    return enriched;
  });
}

/** 从候选视图里挑一个最该改的：优先选文件存在的 */
function pickView(views, kitDir) {
  if (!kitDir) return views[0];
  for (const v of views) {
    if (fs.existsSync(path.join(kitDir, v))) return v;
  }
  return views[0];
}

module.exports = {
  DIAGRAM_VIEWS,
  viewsForKind,
  locateInSource,
  buildFixPrompt,
  enrichDriftItems,
  buildVariants
};
